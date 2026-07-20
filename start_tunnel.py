import os
import sys
import subprocess
import re
import time
import urllib.request
import signal
import tarfile

# Constants
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
BIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bin')
CLOUDFLARED_BIN = os.path.join(BIN_DIR, 'cloudflared')
PYTHON_EXEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.venv', 'bin', 'python')

if not os.path.exists(PYTHON_EXEC):
    PYTHON_EXEC = sys.executable

# Subprocesses list for clean termination
processes = []

def cleanup(signum=None, frame=None):
    print("\n\nStopping StreamVault and closing Cloudflare Tunnel...")
    for p in processes:
        try:
            p.terminate()
            p.wait(timeout=3)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
    print("Cleanup complete. Goodbye!")
    sys.exit(0)

# Register termination signals
signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

def download_cloudflared():
    os.makedirs(BIN_DIR, exist_ok=True)
    if os.path.exists(CLOUDFLARED_BIN):
        return

    print("--------------------------------------------------")
    print("Downloading Cloudflare Tunnel client (cloudflared)...")
    print("This will only happen once.")
    print("--------------------------------------------------")
    try:
        tgz_path = CLOUDFLARED_BIN + ".tgz"
        print(f"Downloading from: {CLOUDFLARED_URL}")
        urllib.request.urlretrieve(CLOUDFLARED_URL, tgz_path)
        
        print("Extracting cloudflared executable...")
        with tarfile.open(tgz_path, "r:gz") as tar:
            tar.extract("cloudflared", path=BIN_DIR)
            
        os.remove(tgz_path)
        os.chmod(CLOUDFLARED_BIN, 0o755)
        print("[SUCCESS] cloudflared downloaded and configured successfully.\n")
    except Exception as e:
        print(f"[ERROR] Failed to download/extract cloudflared: {e}")
        print("Please check your internet connection or install cloudflared manually.")
        sys.exit(1)

def main():
    download_cloudflared()

    print("Starting local StreamVault server...")
    # Start Flask server
    flask_proc = subprocess.Popen(
        [PYTHON_EXEC, 'app.py'],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    processes.append(flask_proc)

    # Give Flask a second to boot
    time.sleep(2)
    if flask_proc.poll() is not None:
        print("[ERROR] Flask server failed to start. Logs:")
        print(flask_proc.stdout.read())
        sys.exit(1)

    print("Opening secure Cloudflare Tunnel...")
    # Start cloudflared quick tunnel
    cf_proc = subprocess.Popen(
        [CLOUDFLARED_BIN, 'tunnel', '--url', 'http://127.0.0.1:5000'],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1
    )
    processes.append(cf_proc)

    # Monitor cloudflared stderr/stdout to extract the public URL
    # Cloudflare prints the tunnel URL to stderr
    tunnel_url = None
    start_time = time.time()
    
    # Non-blocking check for tunnel URL
    while time.time() - start_time < 30:
        if cf_proc.poll() is not None:
            print("[ERROR] Cloudflare Tunnel failed to start. Logs:")
            print(cf_proc.stderr.read())
            cleanup()

        line = cf_proc.stderr.readline()
        if not line:
            time.sleep(0.1)
            continue
            
        # Match trycloudflare URL
        match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
        if match:
            tunnel_url = match.group(0)
            break

    if tunnel_url:
        print("\n" + "="*60)
        print("🚀 STREAMVAULT IS NOW LIVE ON THE INTERNET!")
        print(f"👉 Public Link: \033[92;1m{tunnel_url}\033[0m")
        print("="*60 + "\n")
        print("Keep this terminal open to keep the website active.")
        print("Press Ctrl + C at any time to stop the server.\n")
    else:
        print("[WARNING] Could not retrieve the tunnel URL automatically.")
        print("Please check your network settings.")

    # Keep script running and print output logs
    while True:
        # Check if processes are alive
        if flask_proc.poll() is not None:
            print("[ERROR] Flask server stopped unexpectedly.")
            cleanup()
        if cf_proc.poll() is not None:
            print("[ERROR] Cloudflare Tunnel stopped unexpectedly.")
            cleanup()
        
        # Read flask output
        line = flask_proc.stdout.readline()
        if line:
            # Optionally print logs
            if "POST" in line or "GET" in line or "DEBUG" in line:
                print(f"[Server] {line.strip()}")
        else:
            time.sleep(0.1)

if __name__ == "__main__":
    main()
