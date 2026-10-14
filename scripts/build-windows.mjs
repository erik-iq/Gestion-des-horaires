import { build, transform } from "esbuild";
import { inject } from "postject";
import { readFile, writeFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.versions.node;
const appVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
if (Number(version.split(".")[0]) < 24)
  throw new Error("Node.js 24 ou supérieur est requis.");
const dist = path.join(root, "dist");
const cache = path.join(dist, "build");
await mkdir(cache, { recursive: true });
const release = `node-v${version}-win-x64`;
const archiveName = release + ".zip";
const releaseUrl = `https://nodejs.org/download/release/v${version}/`;
async function download(name) {
  const destination = path.join(cache, name);
  await exec("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--retry",
    "2",
    "--output",
    destination,
    releaseUrl + name,
  ]);
  return destination;
}
console.log(
  "Téléchargement du moteur Windows officiel et vérification SHA-256…",
);
const checksums = await readFile(await download("SHASUMS256.txt"), "utf8");
const expected = checksums
  .split("\n")
  .find((line) => line.trim().endsWith("  " + archiveName))
  ?.split(/\s+/)[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected))
  throw new Error("Checksum officiel du moteur Windows introuvable.");
let archive = path.join(cache, archiveName);
try {
  const cachedHash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (cachedHash !== expected) archive = await download(archiveName);
} catch {
  archive = await download(archiveName);
}
const actual = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
if (actual !== expected)
  throw new Error("La vérification du moteur Windows a échoué.");
await exec("unzip", [
  "-o",
  "-j",
  archive,
  release + "/node.exe",
  release + "/LICENSE",
  "-d",
  cache,
]);
const bundled = path.join(cache, "tempo.cjs");
await build({
  entryPoints: [path.join(root, "server.js")],
  outfile: bundled,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  define: { "import.meta.url": "__TEMPO_FILE_URL__" },
  banner: {
    js: 'const __TEMPO_FILE_URL__ = require("node:url").pathToFileURL(__filename).href;',
  },
});
const blob = path.join(cache, "tempo.blob");
const config = path.join(cache, "sea.json");
const assetsDirectory = path.join(cache, "assets");
await mkdir(assetsDirectory, { recursive: true });
const frontendFiles = [
  "index.html",
  "app.js",
  "calendar.js",
  "metrics.js",
  "theme.js",
  "style.css",
];
const binaryAssets = [
  "assets/logo.png",
  "assets/report-font.ttf",
  "assets/FONT-LICENSE.txt",
];
for (const name of frontendFiles) {
  const source = await readFile(path.join(root, "public", name), "utf8");
  const contents =
    name.endsWith(".js") || name.endsWith(".css")
      ? (
          await transform(source, {
            loader: name.endsWith(".css") ? "css" : "js",
            minify: true,
            target: "es2022",
          })
        ).code
      : source;
  await writeFile(path.join(assetsDirectory, name), contents);
}
await writeFile(
  config,
  JSON.stringify(
    {
      main: bundled,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: "none",
      assets: Object.fromEntries([
        ...frontendFiles.map((name) => [
          name,
          path.join(assetsDirectory, name),
        ]),
        ...binaryAssets.map((name) => [name, path.join(root, "public", name)]),
        ["licenses.txt", path.join(cache, "LICENSE")],
      ]),
    },
    null,
    2,
  ),
);
await exec(process.execPath, ["--experimental-sea-config", config]);
const executable = path.join(dist, "Tempo.exe");
await copyFile(path.join(cache, "node.exe"), executable);
await inject(executable, "NODE_SEA_BLOB", await readFile(blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});
// Une application graphique n'ouvre pas de console au double-clic.
// La signature du moteur ne s'applique pas à notre application modifiée.
const pe = await readFile(executable);
const peOffset = pe.readUInt32LE(0x3c);
if (pe.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0")
  throw new Error("Fichier Windows PE invalide.");
const optional = peOffset + 24;
if (pe.readUInt16LE(optional) !== 0x20b)
  throw new Error("Un exécutable Windows x64 est attendu.");
pe.writeUInt16LE(2, optional + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI
pe.writeUInt32LE(0, optional + 64); // Le checksum PE n'est pas requis pour une application utilisateur.
pe.fill(0, optional + 112 + 8 * 4, optional + 112 + 8 * 4 + 8); // Supprimer la référence Authenticode devenue invalide.
await writeFile(executable, pe);
const digest = createHash("sha256").update(pe).digest("hex");
await writeFile(path.join(dist, "SHA256SUMS.txt"), `${digest}  Tempo.exe\n`);
await copyFile(
  path.join(cache, "LICENSE"),
  path.join(dist, "LICENSE-Node.txt"),
);
await writeFile(
  path.join(dist, "LISEZ-MOI.txt"),
  `TEMPO ${appVersion} — Application Windows portable\r\n\r\n1. Extraire ce ZIP puis double-cliquer sur Tempo.exe. Aucun logiciel supplémentaire à installer.\r\n2. L'interface s'ouvre dans votre navigateur. Connectez-vous, ou créez votre premier compte lors d'une nouvelle utilisation.\r\n3. Saisir vos heures et gérer vos vacances et utilisateurs.\r\n4. Utilisez les vues mois, semaine, jour ou liste ; le solde d'heures, les saisies rapides et les validations sont accessibles dans les menus.\r\n5. Les rapports PDF intègrent le logo et les signatures ; le thème clair/sombre se change en haut de l'application.\r\n6. Utiliser « Quitter Tempo » dans l'application pour l'arrêter complètement.\r\n\r\nMISE À JOUR : quittez d'abord l'ancienne version, puis ouvrez le nouveau Tempo.exe. Ne supprimez pas %LOCALAPPDATA%\\Tempo : vos comptes et vos données sont conservés.\r\n\r\nCompatible avec Windows 10/11, processeur x64.\r\nDonnées : %LOCALAPPDATA%\\Tempo\\horaires.sqlite\r\nLes données sont locales à votre compte Windows. Plusieurs PC ne synchronisent pas leurs données.\r\nPour sauvegarder, quitter Tempo et copier tout le dossier %LOCALAPPDATA%\\Tempo.\r\n\r\nCette version n'est pas signée avec un certificat éditeur. Une alerte Windows est possible.\r\nNe désactivez pas votre antivirus. Le fichier SHA256SUMS.txt permet de contrôler son intégrité.\r\n\r\nL'interface s'ouvre dans le navigateur : le service fonctionne uniquement sur votre ordinateur.\r\nNode.js ${version} est intégré ; ses licences sont incluses dans LICENSE-Node.txt et dans l'application.\r\n`,
);
const zipName = "Tempo-Windows-x64.zip";
await exec("zip", [
  "-j",
  "-q",
  path.join(dist, zipName),
  executable,
  path.join(dist, "LISEZ-MOI.txt"),
  path.join(dist, "LICENSE-Node.txt"),
  path.join(dist, "SHA256SUMS.txt"),
]);
// Même blob, moteur Linux : permet de vérifier que les ressources sont embarquées.
if (process.platform === "linux") {
  const linux = path.join(cache, "Tempo-linux-test");
  await copyFile(process.execPath, linux);
  await inject(linux, "NODE_SEA_BLOB", await readFile(blob), {
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  });
  await chmod(linux, 0o755);
}
console.log(
  `Application créée : ${executable}\nArchive : ${path.join(dist, zipName)}\nSHA-256 : ${digest}`,
);
