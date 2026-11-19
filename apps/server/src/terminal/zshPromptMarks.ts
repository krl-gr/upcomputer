import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Holds the user's own ZDOTDIR while ours is in place; the startup file restores it. */
const ZSH_USER_ZDOTDIR_ENV_KEY = "T3CODE_ZSH_ZDOTDIR";

/** zsh reads `$ZDOTDIR/.zshenv` first; this one marks the prompt and hands startup back. */
const ZSH_PROMPT_MARKS_ZSHENV = String.raw`# Up.computer starts zsh terminals here. It marks the prompt with OSC 133, so the
# terminal knows where the prompt begins when a resize makes zsh redraw it, then lets
# the user's own startup files run. The app rewrites this file.

# The server set ZDOTDIR to this directory and kept the user's own value aside.
if [[ -v T3CODE_ZSH_ZDOTDIR ]]; then
  ZDOTDIR=$T3CODE_ZSH_ZDOTDIR
else
  unset ZDOTDIR
fi
unset T3CODE_ZSH_ZDOTDIR

if [[ -o interactive ]]; then
  typeset -g _t3code_ps1 _t3code_ps1_marked _t3code_ps2 _t3code_ps2_marked
  typeset -gi _t3code_shown

  # Sets REPLY to the prompt $1 between prompt-start and prompt-end marks.
  _t3code_mark() {
    emulate -L zsh
    local rest=$1
    integer percents=0
    while [[ $rest == *% ]]; do rest=$rest[1,-2]; percents+=1; done
    REPLY=$1
    # An odd run of trailing % would escape the % of the closing mark.
    if (( percents % 2 )); then REPLY+=%; fi
    REPLY=$'%{\e]133;A\a%}'$REPLY$'%{\e]133;B\a%}'
  }

  # PS2 is marked too: a resize at a continuation prompt redraws only that line.
  _t3code_mark_prompts() {
    local percent=0 REPLY
    [[ -o prompt_percent ]] && percent=1
    emulate -L zsh
    (( percent )) || return 0
    if [[ $PS1 != *$'\e]133;A'* ]]; then
      _t3code_ps1=$PS1
      _t3code_mark "$PS1"
      PS1=$REPLY _t3code_ps1_marked=$REPLY
    fi
    if [[ $PS2 != *$'\e]133;A'* ]]; then
      _t3code_ps2=$PS2
      _t3code_mark "$PS2"
      PS2=$REPLY _t3code_ps2_marked=$REPLY
    fi
  }

  _t3code_precmd() {
    emulate -L zsh
    # Stay the last hook, so a theme that rebuilds PS1 in its own precmd keeps the marks.
    integer index=$precmd_functions[(I)_t3code_precmd]
    if (( index && index < $#precmd_functions )); then
      precmd_functions[index]=()
      precmd_functions+=(_t3code_precmd)
    fi
    if (( ! _t3code_shown )); then
      _t3code_shown=1
      # Hooks after ours still run before this first prompt, so check it again once zle shows it.
      autoload -Uz add-zle-hook-widget
      add-zle-hook-widget line-init _t3code_first_line 2>/dev/null
    fi
    _t3code_mark_prompts
  }

  _t3code_first_line() {
    emulate -L zsh
    add-zle-hook-widget -d line-init _t3code_first_line
    local ps1=$PS1 ps2=$PS2
    _t3code_mark_prompts
    [[ $PS1 == "$ps1" && $PS2 == "$ps2" ]] || zle reset-prompt
  }

  _t3code_preexec() {
    emulate -L zsh
    [[ $PS1 != "$_t3code_ps1_marked" ]] || PS1=$_t3code_ps1
    [[ $PS2 != "$_t3code_ps2_marked" ]] || PS2=$_t3code_ps2
    print -n $'\e]133;C\a'
  }

  precmd_functions+=(_t3code_precmd)
  preexec_functions+=(_t3code_preexec)
fi

# Last, the user's own .zshenv, from where zsh itself would have read it.
if [[ -v ZDOTDIR ]]; then
  if [[ -r $ZDOTDIR/.zshenv ]]; then . "$ZDOTDIR/.zshenv"; fi
elif [[ -r $HOME/.zshenv ]]; then
  . "$HOME/.zshenv"
fi
`;

/**
 * Builds the spawn environment for a terminal shell. zsh starts from the prompt-marks
 * file in `directory` and gets the user's ZDOTDIR back from it. Other shells, Windows,
 * and a failed write keep `env`, so zsh never starts without the user's own files.
 */
export const makeZshPromptMarks = Effect.fn("terminal.makeZshPromptMarks")(function* (
  directory: string | undefined,
  platform: NodeJS.Platform,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Checked on every spawn and replaced atomically, so a deleted or half-written file never
  // leaves ZDOTDIR pointing at nothing.
  const ensureStartupFile = Effect.fn("terminal.ensureZshPromptMarks")(function* (
    directory: string,
  ) {
    const file = path.join(directory, ".zshenv");
    const current = yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => null));
    if (current === ZSH_PROMPT_MARKS_ZSHENV) return;
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    const staging = yield* fileSystem.makeTempDirectory({ directory });
    const staged = path.join(staging, ".zshenv");
    yield* fileSystem
      .writeFileString(staged, ZSH_PROMPT_MARKS_ZSHENV)
      .pipe(
        Effect.andThen(fileSystem.rename(staged, file)),
        Effect.ensuring(fileSystem.remove(staging, { recursive: true }).pipe(Effect.ignore)),
      );
  });

  return Effect.fn("terminal.withZshPromptMarks")(function* (
    shell: string,
    env: NodeJS.ProcessEnv,
  ) {
    if (directory === undefined || platform === "win32") return env;
    if (path.basename(shell).toLowerCase() !== "zsh") return env;
    const written = yield* ensureStartupFile(directory).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        Effect.logWarning("failed to write zsh prompt marks", { error }).pipe(Effect.as(false)),
      ),
    );
    if (!written) return env;
    const next: NodeJS.ProcessEnv = { ...env, ZDOTDIR: directory };
    delete next[ZSH_USER_ZDOTDIR_ENV_KEY];
    if (env.ZDOTDIR !== undefined) next[ZSH_USER_ZDOTDIR_ENV_KEY] = env.ZDOTDIR;
    return next;
  });
});
