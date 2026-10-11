import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"
BUILD = ROOT / "build"
OUT = ROOT / "Annamaya.apk"

VERSION_CODE = "5"
VERSION_NAME = "2.3.0"
MIN_SDK = "29"
TARGET_SDK = "34"

WEB = ["index.html", "manifest.webmanifest", "css", "js", "icons", "menu"]

KEYSTORE = ANDROID / "annamaya.keystore"
KEY_ALIAS = "annamaya"
KEY_PASS = "annamaya-local-key"


def sdk_root():
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(env):
            return Path(os.environ[env])
    guess = Path.home() / "AppData/Local/Android/Sdk"
    if guess.exists():
        return guess
    sys.exit("Android SDK not found. Set ANDROID_HOME.")


def newest(folder):
    def key(p):
        return [int(x) if x.isdigit() else 0 for x in p.name.replace("android-", "").replace("-", ".").split(".")]
    items = sorted((p for p in folder.iterdir() if p.is_dir()), key=key)
    if not items:
        sys.exit(f"Nothing installed under {folder}")
    return items[-1]


def jdk_tool(name):
    found = shutil.which(name)
    if found:
        return found
    exe = name + (".exe" if os.name == "nt" else "")
    homes = [os.environ.get("JAVA_HOME"), *sorted(Path("C:/Program Files/Java").glob("*"), reverse=True),
             "C:/Program Files/Android/Android Studio/jbr"]
    for home in homes:
        if home and (Path(home) / "bin" / exe).exists():
            return str(Path(home) / "bin" / exe)
    sys.exit(f"{name} not found. Install a JDK or set JAVA_HOME.")


def run(*cmd):
    cmd = [str(c) for c in cmd]
    print("  $", Path(cmd[0]).name, *cmd[1:4], "..." if len(cmd) > 4 else "")
    result = subprocess.run(cmd, capture_output=True, text=True, shell=cmd[0].endswith(".bat"))
    if result.returncode != 0:
        sys.exit(f"FAILED: {' '.join(cmd)}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def main():
    sdk = sdk_root()
    tools = newest(sdk / "build-tools")
    platform = newest(sdk / "platforms") / "android.jar"
    exe = ".exe" if os.name == "nt" else ""
    bat = ".bat" if os.name == "nt" else ""
    print(f"SDK {sdk}\nbuild-tools {tools.name}, platform {platform.parent.name}")

    shutil.rmtree(BUILD, ignore_errors=True)
    www = BUILD / "assets" / "www"
    www.mkdir(parents=True)
    for name in WEB:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, www / name)
        else:
            shutil.copy2(src, www / name)

    print("resources")
    run(tools / f"aapt2{exe}", "compile", "--dir", ANDROID / "res", "-o", BUILD / "res.zip")
    run(tools / f"aapt2{exe}", "link", "-o", BUILD / "base.apk", "-I", platform,
        "--manifest", ANDROID / "AndroidManifest.xml", "-A", BUILD / "assets", "--java", BUILD / "gen",
        "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
        "--version-code", VERSION_CODE, "--version-name", VERSION_NAME, BUILD / "res.zip")

    print("java")
    sources = [*ANDROID.joinpath("src").rglob("*.java"), *BUILD.joinpath("gen").rglob("*.java")]
    classes = BUILD / "classes"
    classes.mkdir()
    run(jdk_tool("javac"), "--release", "11", "-Xlint:-options", "-cp", platform, "-d", classes, *sources)
    dex = BUILD / "dex"
    dex.mkdir()
    run(tools / f"d8{bat}", "--release", "--min-api", MIN_SDK, "--lib", platform, "--output", dex, *classes.rglob("*.class"))
    with zipfile.ZipFile(BUILD / "base.apk", "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(dex / "classes.dex", "classes.dex")

    print("align + sign")
    run(tools / f"zipalign{exe}", "-f", "-p", "4", BUILD / "base.apk", BUILD / "aligned.apk")
    if not KEYSTORE.exists():
        run(jdk_tool("keytool"), "-genkeypair", "-keystore", KEYSTORE, "-alias", KEY_ALIAS, "-keyalg", "RSA", "-keysize", "2048",
            "-validity", "10000", "-storepass", KEY_PASS, "-keypass", KEY_PASS, "-dname", "CN=Annamaya")
    run(tools / f"apksigner{bat}", "sign", "--ks", KEYSTORE, "--ks-key-alias", KEY_ALIAS,
        "--ks-pass", f"pass:{KEY_PASS}", "--key-pass", f"pass:{KEY_PASS}", "--out", OUT, BUILD / "aligned.apk")
    print(run(tools / f"apksigner{bat}", "verify", "--print-certs", OUT).splitlines()[0])
    print(f"\nBuilt {OUT}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
