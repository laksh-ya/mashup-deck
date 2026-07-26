"""Start the deck and open it in a browser. One command, every platform.

    python run.py

This is what the Desktop launcher runs, and it is the same thing you want during
development, so there is only one code path to keep working. It picks a free
port, waits until the server actually answers, then opens the default browser.

Loopback only by default, on purpose: a server listening on every interface is
what makes macOS ask whether to accept incoming connections and makes Windows
Firewall pop a permission dialog. Neither says anything about 127.0.0.1, and
avoiding those dialogs is the whole point of how this is packaged.

Set MASHUP_LAN=1 to bind every interface anyway, which is how a phone on the same
wifi can use a laptop's copy. That is when you will see the firewall prompt, once.
"""

import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

PREFERRED_PORT = int(os.environ.get('PORT') or 8765)
LAN = os.environ.get('MASHUP_LAN') == '1'

# Tells the app it is running on someone's own machine, so it does not warn about
# the missing cookie file that only a cloud host needs.
os.environ['MASHUP_LOCAL'] = '1'


def free_port() -> int:
    """The preferred port if it is free, otherwise whatever the OS hands out."""
    for candidate in list(range(PREFERRED_PORT, PREFERRED_PORT + 20)) + [0]:
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', candidate))
            except OSError:
                continue
            return s.getsockname()[1]
    return PREFERRED_PORT


def lan_address() -> str:
    """This machine's address on the local network, for the phone case."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            # nothing is sent; this just asks the OS which interface it would use
            s.connect(('8.8.8.8', 53))
            return s.getsockname()[0]
        except OSError:
            return '127.0.0.1'


def announce(port: int) -> None:
    """Wait for the server to answer, then open the browser and say the URL."""
    url = f'http://127.0.0.1:{port}'
    for _ in range(120):
        try:
            with urllib.request.urlopen(f'{url}/api/health', timeout=1):
                break
        except Exception:
            time.sleep(0.5)
    else:
        print('  It did not come up. The output above says why.')
        return

    print('')
    print(f'  Mashup Deck is ready:  {url}')
    if LAN:
        print(f'  On a phone on the same wifi:  http://{lan_address()}:{port}')
    print('')
    print('  Everything happens on this computer. Close this window when done.')
    print('')

    if os.environ.get('MASHUP_NO_BROWSER') != '1':
        try:
            webbrowser.open(url)
        except Exception:
            pass


def main() -> int:
    try:
        import uvicorn
    except ImportError:
        print('The dependencies are missing. Install them with:')
        print('    pip install -r requirements.txt')
        return 1

    port = free_port()
    threading.Thread(target=announce, args=(port,), daemon=True).start()

    # log_level warning because the launcher window is for a person, not a log
    uvicorn.run(
        'main:app',
        host='0.0.0.0' if LAN else '127.0.0.1',
        port=port,
        log_level=os.environ.get('MASHUP_LOG_LEVEL', 'warning'),
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
