import subprocess
import sys
import os
import platform
import time
import shutil
import signal
import atexit

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(BASE_DIR, "server.py")
EXT_DIR       = os.path.join(BASE_DIR, "extension")

server_proc = None


def start_server():
    """Starts server.py in its own process."""
    return subprocess.Popen([sys.executable, SERVER_SCRIPT],
                             stdout=sys.stdout,
                             stderr=sys.stderr)

def find_chrome_executable():
    """Try common Chrome paths by OS; let user override if needed."""
    system = platform.system()
    if system == "Windows":
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]
    elif system == "Darwin":
        candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    else:
        candidates = ["google-chrome", "chrome", "chromium-browser"]

    for path in candidates:
        if os.path.exists(path) or shutil.which(path):
            return path
    sys.exit("❌ Chrome not found—please install or adjust launcher.py.")

def launch_chrome_with_extension():
    chrome = find_chrome_executable()
    subprocess.Popen([chrome, f"--load-extension={EXT_DIR}"])

def cleanup(signum=None, frame=None):
    """Terminate the server if it's still running."""
    global server_proc
    if server_proc and server_proc.poll() is None:
        print("\n🛑 Shutting down server…")
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_proc.kill()
    sys.exit(0)

if __name__ == "__main__":
    atexit.register(cleanup)
    signal.signal(signal.SIGINT,  cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    server_proc = start_server()
    print("🚀 Server started.")

    time.sleep(2)

    launch_chrome_with_extension()
    print("🌐 Chrome launched with extension.")

    server_proc.wait()
