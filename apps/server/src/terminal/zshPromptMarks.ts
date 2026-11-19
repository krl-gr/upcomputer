import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Holds the user's own ZDOTDIR while ours is in place; the startup file restores it. */
const ZSH_USER_ZDOTDIR_ENV_KEY = "T3CODE_ZSH_ZDOTDIR";

/**
 * zsh reads `$ZDOTDIR/.zshenv` first. This one hands ZDOTDIR back before loading the
 * user's own startup files, then wraps PS1 in OSC 133 prompt marks so the web terminal
 * knows where the prompt starts when a resize makes zsh redraw it.
 */
const ZSH_PROMPT_MARKS_ZSHENV = String.raw`# Written by Up.computer for its terminals. Changes are overwritten.
if (( $+T3CODE_ZSH_ZDOTDIR )); then
  'builtin' 'export' ZDOTDIR=$T3CODE_ZSH_ZDOTDIR
  'builtin' 'unset' 'T3CODE_ZSH_ZDOTDIR'
else
  'builtin' 'unset' 'ZDOTDIR'
fi

{
  if (( $+ZDOTDIR )); then 'builtin' 'typeset' _t3code_file=$ZDOTDIR/.zshenv
  else 'builtin' 'typeset' _t3code_file=$HOME/.zshenv; fi
  [[ ! -r $_t3code_file ]] || 'builtin' 'source' '--' "$_t3code_file"
} always {
  'builtin' 'unset' '_t3code_file'
  if [[ -o 'interactive' ]] && (( ! $+functions[_t3code_prompt_marks] )); then
    'builtin' 'typeset' -g _t3code_ps1 _t3code_marked_ps1
    _t3code_prompt_marks() {
      'builtin' 'emulate' -L zsh -o no_aliases
      # Stay last, so a theme that rebuilds PS1 in its own precmd keeps the marks.
      'builtin' 'local' -i index=$precmd_functions[(I)_t3code_prompt_marks]
      if (( index && index != $#precmd_functions )); then
        precmd_functions[index]=()
        precmd_functions+=(_t3code_prompt_marks)
      fi
      [[ -o prompt_percent && $PS1 != *$'\e]133;A'* ]] || 'builtin' 'return' 0
      _t3code_ps1=$PS1
      # A trailing bare % would swallow the brace of the closing mark.
      [[ $PS1 == *[^%]% || $PS1 == % ]] && PS1+=%
      PS1=$'%{\e]133;A\a%}'$PS1$'%{\e]133;B\a%}'
      _t3code_marked_ps1=$PS1
    }
    _t3code_command_mark() {
      'builtin' 'emulate' -L zsh -o no_aliases
      [[ $PS1 != "$_t3code_marked_ps1" ]] || PS1=$_t3code_ps1
      'builtin' 'print' -n $'\e]133;C\a'
    }
    'builtin' 'typeset' -ag precmd_functions preexec_functions
    precmd_functions+=(_t3code_prompt_marks)
    preexec_functions+=(_t3code_command_mark)
  fi
}
`;

/** Writes the startup file; terminals keep the user's plain zsh startup when this fails. */
export const writeZshPromptMarks = Effect.fn("terminal.writeZshPromptMarks")(function* (
  directory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ".zshenv");
  const current = yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  if (current === ZSH_PROMPT_MARKS_ZSHENV) return;
  yield* fileSystem.makeDirectory(directory, { recursive: true });
  yield* fileSystem.writeFileString(file, ZSH_PROMPT_MARKS_ZSHENV);
});

/** Spawn environment that makes zsh start from `directory` and then restore the user's ZDOTDIR. */
export function zshPromptMarksEnv(env: NodeJS.ProcessEnv, directory: string): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, ZDOTDIR: directory };
  delete next[ZSH_USER_ZDOTDIR_ENV_KEY];
  if (env.ZDOTDIR !== undefined) next[ZSH_USER_ZDOTDIR_ENV_KEY] = env.ZDOTDIR;
  return next;
}
