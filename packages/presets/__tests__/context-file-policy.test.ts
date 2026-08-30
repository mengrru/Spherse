import { describe, it, expect } from "vitest";
import {
  CONTEXT_TOTAL_SIZE_LIMIT_BYTES,
  isTextContextPath,
  TEXT_FILE_EXTENSIONS,
} from "../src/context-file-policy.js";

describe("isTextContextPath", () => {
  it("accepts document extensions", () => {
    for (const p of ["notes.txt", "world.md", "README.MARKDOWN", "outline.rst", "a/b/c.md"]) {
      expect(isTextContextPath(p), p).toBe(true);
    }
  });

  it("accepts data and config extensions", () => {
    for (const p of [
      "data.json",
      "conf.yaml",
      "conf.yml",
      "settings.toml",
      "table.csv",
      "table.tsv",
      "feed.xml",
      "page.html",
      "app.ini",
      "schema.sql",
      "api.graphql",
      "buf.proto",
      "yarn.lock",
      "app.log",
    ]) {
      expect(isTextContextPath(p), p).toBe(true);
    }
  });

  it("accepts web and script extensions", () => {
    for (const p of ["style.css", "style.scss", "main.js", "main.mjs", "main.cjs", "main.ts", "main.tsx", "Comp.jsx", "App.vue", "Page.svelte"]) {
      expect(isTextContextPath(p), p).toBe(true);
    }
  });

  it("accepts general programming language extensions", () => {
    for (const p of ["main.py", "app.rb", "main.go", "lib.rs", "Main.java", "main.kt", "main.swift", "main.c", "header.h", "main.cpp", "Main.cs", "index.php", "main.dart", "run.sh", "run.bash", "Taskfile.ps1", "build.gradle", "main.tf"]) {
      expect(isTextContextPath(p), p).toBe(true);
    }
  });

  it("matches extensions case-insensitively", () => {
    expect(isTextContextPath("world.MD")).toBe(true);
    expect(isTextContextPath("world.JSON")).toBe(true);
    expect(isTextContextPath("world.PNG")).toBe(false);
  });

  it("accepts well-known extensionless filenames case-insensitively", () => {
    for (const p of ["Makefile", "makefile", "Dockerfile", "LICENSE", "licence", "NOTICE", "readme", "Procfile", "Jenkinsfile", "Vagrantfile", "Gemfile", "Rakefile"]) {
      expect(isTextContextPath(p), p).toBe(true);
    }
  });

  it("accepts dotfiles via basename set and .env family prefix", () => {
    for (const p of [".gitignore", ".gitattributes", ".dockerignore", ".editorconfig", ".env", ".env.local", ".env.production", "config/.env.development"]) {
      expect(isTextContextPath(p), p).toBe(true);
    }
  });

  it("rejects binary and unknown extensions", () => {
    for (const p of [
      "cover.png",
      "photo.jpg",
      "doc.pdf",
      "data.sqlite",
      "app.zip",
      "audio.mp3",
      "video.mp4",
      "font.woff2",
      "db.sqlite3",
      "archive.tar.gz",
    ]) {
      expect(isTextContextPath(p), p).toBe(false);
    }
  });

  it("rejects unknown extensionless files and unknown dotfiles", () => {
    for (const p of ["notes", "data", ".unknownrc", "config/.secret"]) {
      expect(isTextContextPath(p), p).toBe(false);
    }
  });

  it("inspects the final path segment only", () => {
    expect(isTextContextPath("dir.png/photo.md")).toBe(true);
    expect(isTextContextPath("dir.md/photo.png")).toBe(false);
  });

  it("exposes 512kB limit", () => {
    expect(CONTEXT_TOTAL_SIZE_LIMIT_BYTES).toBe(512 * 1024);
    expect(TEXT_FILE_EXTENSIONS.has("md")).toBe(true);
  });
});
