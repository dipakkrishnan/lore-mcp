#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node_dir="$root/lore/node"
question="$*"
model="${LORE_ANSWER_MODEL:-claude-sonnet-5}"
temp_parent="${TMPDIR:-/tmp}"
temp_parent="${temp_parent%/}"
test_root="$(mktemp -d "$temp_parent/lore-test.XXXXXX")"
readonly root node_dir question model temp_parent test_root

cleanup() {
  case "$test_root" in
    "$temp_parent"/lore-test.*) rm -rf -- "$test_root" ;;
    *) printf 'Refusing to remove unexpected test directory: %s\n' "$test_root" >&2 ;;
  esac
}
trap cleanup EXIT

if [[ -z "$question" ]]; then
  printf 'usage: ./lore-test.sh "question"\n' >&2
  exit 2
fi
if (( ${#question} > 4000 )); then
  printf 'question must be 4000 characters or fewer\n' >&2
  exit 2
fi

if [[ "${LORE_TEST_FAKE:-}" != "1" ]]; then
  case "$model" in
    claude-sonnet-5) : "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required}" ;;
    gpt-5.6-luna) : "${OPENAI_API_KEY:?OPENAI_API_KEY is required}" ;;
    *) printf 'unsupported answer model: %s\n' "$model" >&2; exit 2 ;;
  esac
  printf 'Running the real %s proxy; provider charges apply.\n' "$model"
fi

mkdir -p "$test_root/home" "$test_root/tmp"
python="$root/.venv/bin/python"
[[ -x "$python" ]] || python="$(type -P python3)"
PYTHONPATH="$root" "$python" "$node_dir/scripts/eval_data.py" > "$test_root/input.json"

test_env=(
  "PATH=$PATH"
  "PWD=$node_dir"
  "HOME=$test_root/home"
  "TMPDIR=$test_root/tmp"
  "LANG=C"
  "LC_ALL=C"
  "TZ=UTC"
  "WRANGLER_LOG_PATH=$test_root/wrangler.log"
  "LORE_EVAL_INPUT=$test_root/input.json"
  "LORE_EVAL_QUESTION=$question"
  "LORE_ANSWER_MODEL=$model"
)
[[ -z "${ANTHROPIC_API_KEY:-}" ]] || test_env+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
[[ -z "${OPENAI_API_KEY:-}" ]] || test_env+=("OPENAI_API_KEY=$OPENAI_API_KEY")
[[ -z "${LORE_TEST_FAKE:-}" ]] || test_env+=("LORE_TEST_FAKE=$LORE_TEST_FAKE")

cd "$node_dir"
env -i "${test_env[@]}" ./node_modules/.bin/vitest run --config vitest.eval.config.ts
