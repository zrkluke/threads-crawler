---
name: code_review
description: Perform a comprehensive code review of source files in the workspace, evaluating logic, TypeScript type safety, async/promise structures, error handling, and platform compatibility.
---

# Code Review Skill

This skill guides the agent in performing a structured, high-quality code review of files in the codebase.

## When to Use

Use this skill when:
- The user requests a code review of specific files or the entire workspace.
- Major refactoring has occurred (e.g., Python to TypeScript migration) and code quality needs verification.
- You want to identify logical edge cases, performance bottlenecks, or anti-patterns in the source code.

## Step-by-Step Review Guide

### 1. Structure and Imports
- Verify that import file extensions are correct (e.g. Node ESM requires `.js` extensions even when referencing `.ts` source files).
- Check that all imports are actually used and there are no unused dependencies.
- Ensure that `devDependencies` and `dependencies` in `package.json` are logically separated.

### 2. TypeScript and Type Safety
- Verify that `"strict": true` is enabled in `tsconfig.json`.
- Avoid using `any` type casts wherever possible. Recommend explicit types or interfaces.
- Ensure that potential null/undefined values are handled with optional chaining (`?.`) or fallback operators (`??`).

### 3. Async/Promise and Event Loop Safety
- Ensure that all async functions are correctly `await`ed or have proper promise handler chains.
- Check for resource leakages: verify that browser instances, file handles, and network requests are wrapped in `try/finally` blocks to guarantee cleanup.
- Ensure there are no infinite loops or unhandled rejections that could hang the Node event loop.

### 4. Platform-Specific Conventions (Apify/Crawlee)
- Confirm that the `Actor.init()` and `Actor.exit()` are correctly placed and run.
- Check that `Actor.log` is used instead of generic `console.log` where diagnostic logs or exceptions are concerned.
- Ensure that input schemas are validated early and default values are set.

## Output Format

After completing the review, present a **Code Review Walkthrough** artifact (`code_review.md`) containing:
1. **Summary Table**: List of reviewed files, their quality score (e.g., pass/needs optimization), and critical warnings.
2. **Review Findings**: Group findings by category (e.g., Code Quality, Type Safety, Async/Performance).
3. **Remediation Code Snippets**: Provide side-by-side or diff blocks showing the recommended refactored code.
