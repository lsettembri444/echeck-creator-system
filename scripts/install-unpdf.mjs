import { execSync } from "child_process";
console.log("Installing unpdf...");
execSync("cd /vercel/share/v0-project && pnpm add unpdf", { stdio: "inherit" });
console.log("Done.");
