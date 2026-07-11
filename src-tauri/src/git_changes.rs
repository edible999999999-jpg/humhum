use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path};
use std::process::Stdio;
use std::time::Duration;

const MAX_CHANGED_FILES: usize = 80;
const GIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub insertions: u32,
    pub deletions: u32,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitChangeSummary {
    pub branch: Option<String>,
    pub total_files: usize,
    pub truncated: bool,
    pub files: Vec<GitChangedFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StatusRecord {
    path: String,
    status: String,
    staged: bool,
}

pub async fn summarize_workspace(workspace: &Path) -> Result<GitChangeSummary, String> {
    let workspace = workspace
        .canonicalize()
        .map_err(|error| format!("Workspace is unavailable: {error}"))?;
    if !workspace.is_dir() {
        return Err("Workspace must be a directory".into());
    }

    let status = run_git(
        &workspace,
        &[
            "-c",
            "core.quotepath=false",
            "-c",
            "status.relative=false",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        ],
    )
    .await?;
    let unstaged = run_git(
        &workspace,
        &["-c", "core.quotepath=false", "diff", "--numstat", "-z"],
    )
    .await?;
    let staged = run_git(
        &workspace,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--cached",
            "--numstat",
            "-z",
        ],
    )
    .await?;
    let branch = run_git_optional(&workspace, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .await
        .and_then(|output| String::from_utf8(output).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let unstaged_stats = parse_numstat_z(&unstaged);
    let staged_stats = parse_numstat_z(&staged);
    let mut files = parse_status_z(&status)
        .into_iter()
        .filter(|record| is_safe_relative_path(&record.path))
        .map(|record| {
            let unstaged = unstaged_stats
                .get(&record.path)
                .copied()
                .unwrap_or_default();
            let staged = staged_stats.get(&record.path).copied().unwrap_or_default();
            GitChangedFile {
                path: record.path,
                status: record.status,
                staged: record.staged,
                insertions: unstaged.0.saturating_add(staged.0),
                deletions: unstaged.1.saturating_add(staged.1),
                binary: unstaged.2 || staged.2,
            }
        })
        .collect::<Vec<_>>();
    let total_files = files.len();
    files.truncate(MAX_CHANGED_FILES);
    Ok(GitChangeSummary {
        branch,
        total_files,
        truncated: total_files > files.len(),
        files,
    })
}

async fn run_git(workspace: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = tokio::time::timeout(GIT_TIMEOUT, git_command(workspace, args).output())
        .await
        .map_err(|_| "Git inspection timed out after five seconds")?
        .map_err(|error| format!("Could not inspect Git workspace: {error}"))?;
    if !output.status.success() {
        return Err("This session workspace is not an inspectable Git repository".into());
    }
    Ok(output.stdout)
}

async fn run_git_optional(workspace: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = tokio::time::timeout(GIT_TIMEOUT, git_command(workspace, args).output())
        .await
        .ok()?
        .ok()?;
    output.status.success().then_some(output.stdout)
}

fn git_command(workspace: &Path, args: &[&str]) -> tokio::process::Command {
    let mut command = tokio::process::Command::new("git");
    command
        .args(args)
        .current_dir(workspace)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    command
}

fn parse_status_z(output: &[u8]) -> Vec<StatusRecord> {
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut records = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let field = fields[index];
        index += 1;
        if field.len() < 4 || field[2] != b' ' {
            continue;
        }
        let x = field[0];
        let y = field[1];
        let renamed = matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C');
        let path = String::from_utf8_lossy(&field[3..]).to_string();
        if renamed && index < fields.len() {
            index += 1;
        }
        let status = if x == b'?' && y == b'?' {
            "untracked"
        } else if renamed {
            "renamed"
        } else if matches!(x, b'A') || matches!(y, b'A') {
            "added"
        } else if matches!(x, b'D') || matches!(y, b'D') {
            "deleted"
        } else if matches!(x, b'U') || matches!(y, b'U') {
            "conflicted"
        } else {
            "modified"
        };
        records.push(StatusRecord {
            path,
            status: status.into(),
            staged: x != b' ' && x != b'?',
        });
    }
    records
}

fn parse_numstat_z(output: &[u8]) -> HashMap<String, (u32, u32, bool)> {
    let fields = output.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut records = HashMap::new();
    let mut index = 0;
    while index < fields.len() {
        let field = fields[index];
        index += 1;
        if field.is_empty() {
            continue;
        }
        let mut parts = field.splitn(3, |byte| *byte == b'\t');
        let Some(added) = parts.next() else { continue };
        let Some(deleted) = parts.next() else {
            continue;
        };
        let Some(path) = parts.next() else { continue };
        let path = if path.is_empty() && index + 1 < fields.len() {
            index += 1;
            let destination = fields[index];
            index += 1;
            destination
        } else {
            path
        };
        let path = String::from_utf8_lossy(path).to_string();
        if !is_safe_relative_path(&path) {
            continue;
        }
        let binary = added == b"-" || deleted == b"-";
        records.insert(
            path,
            (
                std::str::from_utf8(added)
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0),
                std::str::from_utf8(deleted)
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0),
                binary,
            ),
        );
    }
    records
}

fn is_safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !path.is_absolute()
        && path.components().all(|component| {
            !matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nul_delimited_status_without_exposing_rename_source() {
        let records = parse_status_z(
            b" M src/a.rs\0A  src/new.rs\0?? notes space.md\0R  src/renamed.rs\0src/old.rs\0",
        );

        assert_eq!(records.len(), 4);
        assert_eq!(records[0].path, "src/a.rs");
        assert_eq!(records[0].status, "modified");
        assert!(!records[0].staged);
        assert_eq!(records[1].status, "added");
        assert!(records[1].staged);
        assert_eq!(records[2].path, "notes space.md");
        assert_eq!(records[2].status, "untracked");
        assert_eq!(records[3].path, "src/renamed.rs");
        assert_eq!(records[3].status, "renamed");
    }

    #[test]
    fn parses_text_and_binary_numstat_records() {
        let records = parse_numstat_z(b"4\t2\tsrc/a.rs\0-\t-\tassets/image.png\0");

        assert_eq!(records["src/a.rs"], (4, 2, false));
        assert_eq!(records["assets/image.png"], (0, 0, true));
    }

    #[tokio::test]
    async fn summarizes_a_real_repository_with_relative_paths_only() {
        let temp = tempfile::tempdir().unwrap();
        let init = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(temp.path())
            .status()
            .unwrap();
        assert!(init.success());
        std::fs::write(temp.path().join("tracked.txt"), "one\ntwo\n").unwrap();
        let add = std::process::Command::new("git")
            .args(["add", "tracked.txt"])
            .current_dir(temp.path())
            .status()
            .unwrap();
        assert!(add.success());
        std::fs::write(temp.path().join("notes space.md"), "private body\n").unwrap();

        let summary = summarize_workspace(temp.path()).await.unwrap();

        assert_eq!(summary.total_files, 2);
        assert!(summary.files.iter().all(|file| !file.path.starts_with('/')));
        assert!(summary
            .files
            .iter()
            .any(|file| { file.path == "tracked.txt" && file.staged && file.insertions == 2 }));
        assert!(summary
            .files
            .iter()
            .any(|file| file.path == "notes space.md" && file.status == "untracked"));
    }
}
