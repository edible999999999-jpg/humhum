//! Hexa skill installer.
//!
//! Despite the `connector` name, this module does NOT open a live connection.
//! It installs the `humhum-hexa` CLI (`scripts/humhum-hexa.mjs`) plus the
//! `humhum-hexa` SKILL.md into each supported agent's config directory
//! (`~/.codex`, `~/.claude`, `~/.qoder`, etc.), so an agent can bind its own
//! session to Hexa on request. Idempotent: managed files carry
//! `MANAGED_MARKER` and are only rewritten when the bundled source changes.
//!
//! NOTE: `MANAGED_MARKER` is persisted inside installed SKILL.md files and is
//! how we detect a prior managed install — do not change that string, or
//! existing installs will be orphaned.
use std::fs;
use std::path::Path;

/// Result of an install pass: which skills were (re)written and any warnings.
#[derive(Debug, Default)]
pub(crate) struct HexaConnectorInstallReport {
    pub installed_skills: Vec<String>,
    pub warnings: Vec<String>,
}

const CLI_SOURCE: &str = include_str!("../../scripts/humhum-hexa.mjs");
const MANAGED_MARKER: &str = "HUMHUM_MANAGED_HEXA_CONNECTOR";
const SKILL_CONTEXT_MARKER: &str = " __HUMHUM_CONTEXT_ARGS__";
const SKILL_SOURCE: &str = r#"---
name: humhum-hexa
description: Bind an explicitly requested Agent session to HUMHUM Hexa and report its real plan, milestones, blockers, confirmations, and completion from any project.
---

<!-- HUMHUM_MANAGED_HEXA_CONNECTOR -->

# HUMHUM Hexa supervision

Use this skill only when the user explicitly asks to put the current session under Hexa supervision, for example “重点监控这个会话”, “加入 Hexa”, “让 Hexa 看着这轮”, or “watch this session”.

HumHum is not another Agent. It records the real work state that an Agent reports and presents it to the user; it does not make decisions, invent progress, or replace the Agent's reasoning.

## Bind the real session

Immediately run:

```bash
~/.humhum/bin/humhum-hexa watch "<one-sentence goal>" __HUMHUM_CONTEXT_ARGS__
```

The connector reads the real provider session ID from the Agent runtime. Do not invent a session ID and do not add HUMHUM files or npm dependencies to the current project.

The ordinary `watch` command preserves the existing single-session report. When the user explicitly asks to create a development goal for multiple Agent attempts or comparison, create one with:

```bash
~/.humhum/bin/humhum-hexa watch "<one-sentence goal>" --link-goal --success-criteria "<criterion one>|<criterion two>"
```

When this work belongs to a development goal already shown by Hexa, reuse its exact ID; do not fuzzy-match titles:

```bash
~/.humhum/bin/humhum-hexa watch "<one-sentence goal>" --goal-id "<goal-id>"
```

Only set a runtime surface when its identity is actually known. In particular, Qoder must use one of `--surface qoder_ide`, `--surface qoder_cli`, or `--surface qoder_worker` only when that exact runtime is known. Do not infer IDE versus CLI from a workspace path. With `--link-goal` or `--goal-id`, the `watch` command records the attempt through `/hexa/goal/link` without rolling back an already watched session if the goal link fails.

## Report the plan

Binding only declares the goal. It is not a completed Hexa report. Immediately after `watch`, report the structured plan or explicitly report that the capability is unavailable. Do not stop after printing the watched session ID.

If this Agent exposes a structured plan, report every real work item immediately after binding and whenever the plan changes:

```bash
~/.humhum/bin/humhum-hexa plan --json '{"items":[{"id":"stable-id","title":"user-readable task","status":"pending","depends_on":[]}]}' __HUMHUM_CONTEXT_ARGS__
```

Allowed statuses are `pending`, `in_progress`, `completed`, and `failed`. Keep IDs stable. Do not fabricate work items from tool-call counts or prose.

If this Agent cannot provide a structured plan, report that capability honestly:

```bash
~/.humhum/bin/humhum-hexa plan --capability unavailable --json '{"items":[]}' __HUMHUM_CONTEXT_ARGS__
```

Then tell the user plainly that this Agent integration cannot expose structured work items. This is an Agent capability limitation, not a HUMHUM or Hexa failure.

## Keep the watched session fresh

At meaningful milestones, plan changes, blockers, and user-confirmation points, run:

```bash
~/.humhum/bin/humhum-hexa update "<current progress>" __HUMHUM_CONTEXT_ARGS__
```

Before asking the user for a decision while work remains, explicitly publish the waiting state first:

```bash
~/.humhum/bin/humhum-hexa update --status waiting --need-user --blocked-reason "<decision needed>"
```

After the user responds, immediately return the session to work:

```bash
~/.humhum/bin/humhum-hexa update "<current progress>" --status working
```

A conversational question alone is not a Hexa confirmation signal.

Before and after a long-running phase that may take more than 30 minutes, send an update so Hexa does not correctly classify the silent session as disconnected. Do not create a background polling loop.

When the task is genuinely complete, run:

```bash
~/.humhum/bin/humhum-hexa complete "<result summary>" --result unverified --evidence-label "<evidence>" --evidence-location "<path or command>" __HUMHUM_CONTEXT_ARGS__
```

Agent completion is unverified until evidence or user acceptance exists. An Agent may only report `unverified`, `failed`, or `superseded` through `/hexa/goal/result`; it must never mark itself `verified` or `accepted`. Never invent test results, evidence, or user acceptance.

If the user asks to stop supervision, run:

```bash
~/.humhum/bin/humhum-hexa unwatch __HUMHUM_CONTEXT_ARGS__
```

## Check supervision safely

To verify registration or inspect the current summary, run:

```bash
~/.humhum/bin/humhum-hexa status __HUMHUM_CONTEXT_ARGS__
```

Use this managed status command instead of calling `/hexa/*` with `curl`, piping a response into Python, or asking the user to approve an improvised verification command.
"#;

const SKILL_TARGETS: &[(&str, &str, &str)] = &[
    ("codex", ".codex", ".codex/skills/humhum-hexa/SKILL.md"),
    (
        "claude-code",
        ".claude",
        ".claude/skills/humhum-hexa/SKILL.md",
    ),
    ("qoder", ".qoder", ".qoder/skills/humhum-hexa/SKILL.md"),
    (
        "qoderwork",
        ".qoderwork",
        ".qoderwork/skills/humhum-hexa/SKILL.md",
    ),
    ("cursor", ".cursor", ".cursor/skills/humhum-hexa/SKILL.md"),
    (
        "opencode",
        ".config/opencode",
        ".config/opencode/skills/humhum-hexa/SKILL.md",
    ),
    ("hermes", ".hermes", ".hermes/skills/humhum-hexa/SKILL.md"),
];

fn skill_source(provider: &str) -> String {
    let context = if provider == "hermes" {
        r#" --provider hermes --agent hermes --session-id "${HERMES_SESSION_ID}""#
    } else {
        ""
    };
    SKILL_SOURCE.replace(SKILL_CONTEXT_MARKER, context)
}

pub(crate) fn ensure_installed(home: &Path) -> Result<HexaConnectorInstallReport, String> {
    let cli = home.join(".humhum/bin/humhum-hexa");
    let mut report = HexaConnectorInstallReport::default();
    let mut cli_up_to_date = false;
    match fs::symlink_metadata(&cli) {
        Ok(metadata) => {
            if !metadata.file_type().is_file() {
                report.warnings.push(format!(
                    "kept unsafe global CLI collision at {}; Agent skills were not installed",
                    cli.display()
                ));
                return Ok(report);
            }
            let existing = fs::read_to_string(&cli)
                .map_err(|error| format!("could not inspect Hexa connector CLI: {error}"))?;
            if !existing.contains(MANAGED_MARKER) {
                report.warnings.push(format!(
                    "kept unmanaged global CLI at {}; Agent skills were not installed",
                    cli.display()
                ));
                return Ok(report);
            }
            // Honor the "only rewritten when the bundled source changes" contract:
            // a managed CLI whose content already matches needs no rewrite. This
            // avoids truncating and re-chmod-ing the global executable on every
            // launch (churn + a corruption window agents could observe).
            cli_up_to_date = existing == CLI_SOURCE;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not inspect Hexa connector CLI: {error}")),
    }
    if !cli_up_to_date {
        // Atomic write (temp + rename) so a crash/full-disk mid-write can never
        // leave the global `humhum-hexa` executable — which agents invoke —
        // truncated or half-written. Mirrors the sibling cursor module.
        crate::knowledge_store::write_file_atomically(&cli, CLI_SOURCE.as_bytes())
            .map_err(|error| format!("could not install Hexa connector CLI: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&cli)
                .map_err(|error| format!("could not inspect Hexa connector CLI: {error}"))?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&cli, permissions)
                .map_err(|error| format!("could not make Hexa connector executable: {error}"))?;
        }
    }

    for (provider, detected_root, skill_relative) in SKILL_TARGETS {
        if !home.join(detected_root).is_dir() {
            continue;
        }
        let target = home.join(skill_relative);
        let desired = skill_source(provider);
        let mut skill_up_to_date = false;
        match fs::symlink_metadata(&target) {
            Ok(metadata) => {
                if !metadata.file_type().is_file() {
                    report.warnings.push(format!(
                        "{provider}: kept unsafe skill collision at {}",
                        target.display()
                    ));
                    continue;
                }
                let existing = fs::read_to_string(&target)
                    .map_err(|error| format!("could not inspect {} skill: {error}", provider))?;
                if !existing.contains(MANAGED_MARKER) {
                    report.warnings.push(format!(
                        "{provider}: kept unmanaged skill at {}",
                        target.display()
                    ));
                    continue;
                }
                skill_up_to_date = existing == desired;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("could not inspect {} skill: {error}", provider));
            }
        }
        if !skill_up_to_date {
            // Atomic write so a partial write never leaves a truncated SKILL.md
            // an agent would then read as its instructions.
            crate::knowledge_store::write_file_atomically(&target, desired.as_bytes())
                .map_err(|error| format!("could not install {} Hexa skill: {error}", provider))?;
        }
        // `installed_skills` reflects the set of detected+ensured skill targets
        // this pass (a coverage count for logging), not only those rewritten.
        report
            .installed_skills
            .push(target.to_string_lossy().into_owned());
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn installs_executable_and_managed_skills_without_overwriting_user_files() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::create_dir_all(home.join(".claude")).unwrap();
        fs::create_dir_all(home.join(".hermes")).unwrap();
        let unmanaged = home.join(".qoder/skills/humhum-hexa/SKILL.md");
        fs::create_dir_all(unmanaged.parent().unwrap()).unwrap();
        fs::write(&unmanaged, "user owned").unwrap();

        let report = ensure_installed(home).unwrap();
        let cli = home.join(".humhum/bin/humhum-hexa");
        assert!(cli.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&cli).unwrap().permissions().mode() & 0o111,
                0o111
            );
        }

        for path in [
            ".codex/skills/humhum-hexa/SKILL.md",
            ".claude/skills/humhum-hexa/SKILL.md",
        ] {
            let source = fs::read_to_string(home.join(path)).unwrap();
            assert!(source.contains("HUMHUM_MANAGED_HEXA_CONNECTOR"));
            assert!(source.contains("humhum-hexa plan"));
            assert!(source.contains("HumHum is not another Agent"));
            assert!(source.contains("real provider session ID"));
            assert!(source.contains("--surface qoder_ide"));
            assert!(source.contains("--surface qoder_cli"));
            assert!(source.contains("--surface qoder_worker"));
            assert!(source.contains("--goal-id"));
            assert!(source.contains("--link-goal"));
            assert!(source.contains("do not fuzzy-match titles"));
            assert!(source.contains("--status waiting --need-user --blocked-reason"));
            assert!(source.contains("--status working"));
            assert!(source.contains("/hexa/goal/link"));
            assert!(source.contains("/hexa/goal/result"));
            assert!(source.contains("unverified"));
            assert!(source.contains("Never invent test results"));
            assert!(!source.contains("__HUMHUM_CONTEXT_ARGS__"));
        }
        let hermes_source =
            fs::read_to_string(home.join(".hermes/skills/humhum-hexa/SKILL.md")).unwrap();
        assert!(hermes_source.contains("humhum-hexa status"));
        assert!(hermes_source.contains("--provider hermes"));
        assert!(hermes_source.contains("${HERMES_SESSION_ID}"));
        assert!(hermes_source.contains(
            r#"humhum-hexa status --provider hermes --agent hermes --session-id "${HERMES_SESSION_ID}""#
        ));
        let complete_command = hermes_source
            .lines()
            .find(|line| line.contains("humhum-hexa complete"))
            .unwrap();
        assert!(complete_command.contains("--result unverified"));
        assert!(complete_command.contains("--provider hermes"));
        assert!(complete_command.contains(r#"--session-id "${HERMES_SESSION_ID}""#));
        assert!(!hermes_source.contains(r#""--provider"#));
        assert!(!hermes_source.contains("status--provider"));
        assert!(!hermes_source.contains("__HUMHUM_CONTEXT_ARGS__"));
        assert!(!hermes_source.contains("curl "));
        assert_eq!(fs::read_to_string(&unmanaged).unwrap(), "user owned");
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("qoder")));
        assert_eq!(report.installed_skills.len(), 3);

        let second = ensure_installed(home).unwrap();
        assert_eq!(second.installed_skills.len(), 3);
        assert_eq!(fs::read_to_string(&unmanaged).unwrap(), "user owned");
    }

    #[test]
    fn refuses_to_replace_an_unmanaged_global_cli_or_install_skills_for_it() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let cli = home.join(".humhum/bin/humhum-hexa");
        fs::create_dir_all(cli.parent().unwrap()).unwrap();
        fs::write(&cli, "user owned cli").unwrap();
        fs::create_dir_all(home.join(".codex")).unwrap();

        let report = ensure_installed(home).unwrap();

        assert_eq!(fs::read_to_string(&cli).unwrap(), "user owned cli");
        assert!(!home.join(".codex/skills/humhum-hexa/SKILL.md").exists());
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("unmanaged global CLI")));
    }

    #[test]
    fn managed_files_are_not_rewritten_when_content_already_matches() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        fs::create_dir_all(home.join(".codex")).unwrap();

        ensure_installed(home).unwrap();
        let cli = home.join(".humhum/bin/humhum-hexa");
        let skill = home.join(".codex/skills/humhum-hexa/SKILL.md");

        // Capture mtimes after the first install, then re-run: an up-to-date
        // managed file must not be rewritten (no churn, no corruption window).
        let cli_mtime = fs::metadata(&cli).unwrap().modified().unwrap();
        let skill_mtime = fs::metadata(&skill).unwrap().modified().unwrap();

        ensure_installed(home).unwrap();

        assert_eq!(
            fs::metadata(&cli).unwrap().modified().unwrap(),
            cli_mtime,
            "up-to-date managed CLI must not be rewritten"
        );
        assert_eq!(
            fs::metadata(&skill).unwrap().modified().unwrap(),
            skill_mtime,
            "up-to-date managed skill must not be rewritten"
        );
        assert_eq!(fs::read_to_string(&cli).unwrap(), CLI_SOURCE);
    }

    #[test]
    fn stale_managed_files_are_refreshed_to_the_bundled_source() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        fs::create_dir_all(home.join(".codex")).unwrap();

        // A prior install left an older managed body (still carries the marker).
        let cli = home.join(".humhum/bin/humhum-hexa");
        fs::create_dir_all(cli.parent().unwrap()).unwrap();
        let stale_cli = format!("// old body\n// {MANAGED_MARKER}\n");
        fs::write(&cli, &stale_cli).unwrap();
        let skill = home.join(".codex/skills/humhum-hexa/SKILL.md");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        let stale_skill = format!("stale\n{MANAGED_MARKER}\n");
        fs::write(&skill, &stale_skill).unwrap();

        ensure_installed(home).unwrap();

        assert_eq!(fs::read_to_string(&cli).unwrap(), CLI_SOURCE);
        assert_eq!(fs::read_to_string(&skill).unwrap(), skill_source("codex"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_dangling_cli_and_skill_symlink_collisions() {
        use std::os::unix::fs::symlink;

        let cli_temp = tempfile::tempdir().unwrap();
        let cli_home = cli_temp.path();
        let cli = cli_home.join(".humhum/bin/humhum-hexa");
        let escaped_cli = cli_home.join("outside-cli");
        fs::create_dir_all(cli.parent().unwrap()).unwrap();
        fs::create_dir_all(cli_home.join(".codex")).unwrap();
        symlink(&escaped_cli, &cli).unwrap();

        let cli_report = ensure_installed(cli_home).unwrap();

        assert!(!escaped_cli.exists());
        assert!(fs::symlink_metadata(&cli).unwrap().file_type().is_symlink());
        assert!(!cli_home.join(".codex/skills/humhum-hexa/SKILL.md").exists());
        assert!(cli_report
            .warnings
            .iter()
            .any(|warning| warning.contains("unsafe global CLI collision")));

        let skill_temp = tempfile::tempdir().unwrap();
        let skill_home = skill_temp.path();
        let skill = skill_home.join(".codex/skills/humhum-hexa/SKILL.md");
        let escaped_skill = skill_home.join("outside-skill");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        symlink(&escaped_skill, &skill).unwrap();

        let skill_report = ensure_installed(skill_home).unwrap();

        assert!(!escaped_skill.exists());
        assert!(fs::symlink_metadata(&skill)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(skill_report.installed_skills.is_empty());
        assert!(skill_report
            .warnings
            .iter()
            .any(|warning| warning.contains("unsafe skill collision")));
    }
}
