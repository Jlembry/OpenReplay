"""Execute a CI command with a hard timeout; supports GUI-subsystem Windows executables."""
from __future__ import annotations

import argparse
import subprocess
import sys
import time


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--timeout', type=int, required=True)
    p.add_argument('command', nargs=argparse.REMAINDER)
    args = p.parse_args()
    cmd = args.command
    if cmd and cmd[0] == '--':
        cmd = cmd[1:]
    if not cmd or args.timeout <= 0:
        p.error('A command and a positive --timeout are required')
    print(f"Starting (timeout {args.timeout}s): {' '.join(cmd)}", flush=True)
    t0 = time.monotonic()
    try:
        p = subprocess.run(cmd, timeout=args.timeout, check=False)
    except subprocess.TimeoutExpired:
        print(f'ERROR: Command exceeded {args.timeout}s and was terminated.', file=sys.stderr, flush=True)
        return 124
    except OSError as exc:
        print(f'ERROR: Could not launch: {exc}', file=sys.stderr, flush=True)
        return 127
    elapsed = time.monotonic() - t0
    print(f'Finished with exit code {p.returncode} in {elapsed:.1f}s', flush=True)
    return p.returncode


if __name__ == '__main__':
    sys.exit(main())
