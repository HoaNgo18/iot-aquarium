"""In mã ghép nối để dán nhãn thiết bị: python -m app.cli pairing-code tank-ds18b20-001"""
import sys

from app.security import pairing_code


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] != "pairing-code":
        print("Cách dùng: python -m app.cli pairing-code <device_id>", file=sys.stderr)
        return 2
    print(f"{argv[2]}  {pairing_code(argv[2])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
