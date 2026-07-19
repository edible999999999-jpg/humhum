use std::fs;
use std::path::Path;

#[derive(Debug, Default)]
pub(crate) struct HexaConnectorInstallReport {
    pub installed_skills: Vec<String>,
    pub warnings: Vec<String>,
}

const CLI_SOURCE: &str = include_str!("../../scripts/humhum-hexa.mjs");
const MANAGED_MARKER: &str = "HUMHUM_MANAGED_HEXA_CONNECTOR";
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
~/.humhum/bin/humhum-hexa watch "<one-sentence goal>"
```

The connector reads the real provider session ID from the Agent runtime. Do not invent a session ID and do not add HUMHUM files or npm dependencies to the current project.

When this work belongs to a development goal already shown by Hexa, reuse its exact ID; do not fuzzy-match titles:

```bash
~/.humhum/bin/humhum-hexa watch "<one-sentence goal>" --goal-id "<goal-id>"
```

Only set a runtime surface when its identity is actually known. In particular, Qoder must use one of `--surface qoder_ide`, `--surface qoder_cli`, or `--surface qoder_worker` only when that exact runtime is known. Do not infer IDE versus CLI from a workspace path. The `watch` command records the attempt through `/hexa/goal/link` without rolling back an already watched session if the goal link fails.

## Report the plan

If this Agent exposes a structured plan, report every real work item immediately after binding and whenever the plan changes:

```bash
~/.humhum/bin/humhum-hexa plan --json '{"items":[{"id":"stable-id","title":"user-readable task","status":"pending","depends_on":[]}]}'
```

Allowed statuses are `pending`, `in_progress`, `completed`, and `failed`. Keep IDs stable. Do not fabricate work items from tool-call counts or prose.

If this Agent cannot provide a structured plan, report that capability honestly:

```bash
~/.humhum/bin/humhum-hexa plan --capability unavailable --json '{"items":[]}'
```

Then tell the user plainly that this Agent integration cannot expose structured work items. This is an Agent capability limitation, not a HUMHUM or Hexa failure.

## Keep the watched session fresh

At meaningful milestones, plan changes, blockers, and user-confirmation points, run:

```bash
~/.humhum/bin/humhum-hexa update "<current progress>"
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
~/.humhum/bin/humhum-hexa complete "<result summary>" --result unverified --evidence-label "<evidence>" --evidence-location "<path or command>"
```

Agent completion is unverified until evidence or user acceptance exists. An Agent may only report `unverified`, `failed`, or `superseded` through `/hexa/goal/result`; it must never mark itself `verified` or `accepted`. Never invent test results, evidence, or user acceptance.

If the user asks to stop supervision, run:

```bash
~/.humhum/bin/humhum-hexa unwatch
```
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
];

pub(crate) fn ensure_installed(home: &Path) -> Result<HexaConnectorInstallReport, String> {
    let cli = home.join(".humhum/bin/humhum-hexa");
    let mut report = HexaConnectorInstallReport::default();
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
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not inspect Hexa connector CLI: {error}")),
    }
    if let Some(parent) = cli.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create Hexa connector directory: {error}"))?;
    }
    fs::write(&cli, CLI_SOURCE)
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

    for (provider, detected_root, skill_relative) in SKILL_TARGETS {
        if !home.join(detected_root).is_dir() {
            continue;
        }
        let target = home.join(skill_relative);
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
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("could not inspect {} skill: {error}", provider));
            }
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("could not create {} skill directory: {error}", provider)
            })?;
        }
        fs::write(&target, SKILL_SOURCE)
            .map_err(|error| format!("could not install {} Hexa skill: {error}", provider))?;
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
            assert!(source.contains("do not fuzzy-match titles"));
            assert!(source.contains("--status waiting --need-user --blocked-reason"));
            assert!(source.contains("--status working"));
            assert!(source.contains("/hexa/goal/link"));
            assert!(source.contains("/hexa/goal/result"));
            assert!(source.contains("unverified"));
            assert!(source.contains("Never invent test results"));
        }
        assert_eq!(fs::read_to_string(&unmanaged).unwrap(), "user owned");
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("qoder")));
        assert_eq!(report.installed_skills.len(), 2);

        let second = ensure_installed(home).unwrap();
        assert_eq!(second.installed_skills.len(), 2);
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
