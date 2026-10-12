import sys

from pasak.golden import golden_dir, validate_golden_tree


def main(argv=None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    err = validate_golden_tree(golden_dir())
    if err:
        print(err, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
