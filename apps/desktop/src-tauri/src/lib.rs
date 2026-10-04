use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

// fs plugin 2.6 builds its runtime scope (where the Open dialog grants folders) with unix defaults, so a
// granted `dir/**` never matches dot paths, whatever `requireLiteralLeadingDot` says. Literal paths do match:
// grant every dot-dir / dot-.md inside an already-trusted folder explicitly.
// ponytail: dot-dirs created after opening aren't granted until the folder is reopened.
#[tauri::command]
async fn grant_hidden(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let scope = app.fs_scope();
    if !scope.is_allowed(&root) {
        return Err(format!("not a trusted folder: {root}"));
    }
    for p in hidden_paths(Path::new(&root)) {
        let r = if p.is_dir() { scope.allow_directory(&p, true) } else { scope.allow_file(&p) };
        r.map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Same skips as tree.ts isIgnored: .git, node_modules, symlinks.
fn hidden_paths(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else { return out };
    for e in entries.flatten() {
        let Ok(t) = e.file_type() else { continue }; // doesn't follow symlinks
        let name = e.file_name().to_string_lossy().into_owned();
        let p = e.path();
        if t.is_dir() && name != ".git" && name != "node_modules" {
            if name.starts_with('.') {
                out.push(p.clone());
            }
            out.extend(hidden_paths(&p));
        } else if t.is_file() && name.starts_with('.') && name.to_lowercase().ends_with(".md") {
            out.push(p);
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // Remembers folders granted via the Open dialog across launches. Must come after fs.
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![move_to_trash, grant_hidden])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_dot_dirs_and_dot_md_skipping_git_and_node_modules() {
        let root = std::env::temp_dir().join(format!("md-reader-hidden-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for d in [".scratch/testing", "docs/.drafts", ".git/objects", "node_modules/.bin", "docs/plans"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in [".scratch/testing/grilling.md", ".notes.md", ".DS_Store", "docs/plans/v1.md"] {
            std::fs::write(root.join(f), "").unwrap();
        }
        let mut got: Vec<String> = hidden_paths(&root)
            .iter()
            .map(|p| p.strip_prefix(&root).unwrap().to_string_lossy().into_owned())
            .collect();
        got.sort();
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(got, [".notes.md", ".scratch", "docs/.drafts"]);
    }
}
