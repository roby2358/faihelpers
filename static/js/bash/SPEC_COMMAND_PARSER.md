# Command Line Parsing Specification

This document defines the requirements for command line argument parsing, designed for implementation with PEGGY (PEG parser generator).

## Basic Syntax

### Positional Arguments
- **MUST** preserve order of positional arguments

## Quoting and Escaping

### String Quoting
- **MUST** support multiline single quotes: `'string with spaces'`
- **MUST** support multiline double quotes: `"string with spaces"`
- **MUST** not perform shell expansion, and preserve content within quotes exactly
- **MUST** remove quote delimiters from final argument values (quotes are delimiters, not content)
- **MUST** literally preserve quotes within opposite quote type: `"it's fine"` or `'say "hello"'`
- **MUST** support escaped quotes in double quotes: `"say \"hello\""`
- **MUST NOT** support escaping within single quotes (single quotes are completely literal in bash)
  - Example: `'it\'s fine'` is invalid - the backslash is literal, not an escape
- **MUST** support exactly three backtick quotes for multi-line input
  - This is an allowed difference from bash
- **MUST** preserve newlines inside single, double quotes or triple backtick quotes, to support multi-line input
  - This is an allowed difference from bash
- **MUST NOT** support escaping within triple backtick quotes (triple backtick quotes are completely literal)
  - This is an allowed difference from bash
- **MUST** literally preserve single and double quotes within triple backtick quotes ` ```Say'n "hello"``` `
  - This is a difference from bash
- **MUST** preserve single or double backticks inside triple backtick quotes ` ```back`tick``` `
  - This is a difference from bash
- **MUST NOT** provide for escaped triple backticks
  - The next sequence of triple backticks is not enclosed, it simply closes the quote
  - IT **MUST** NOT BE POSSIBLE TO ENCLOSE TRIPLE BACKTICKS INSIDE TRIPLE BACKTICKS! COME ON!
  - This is a difference from bash
- **MUST** support multiline triple backtick quotes: ` ```line1 line2``` `
  - This is a difference from bash

### Escaping
- **MUST** support backslash escaping outside quotes: `\X` becomes `X` (backslash removed, character preserved)
  - `\\` double backslash becomes single backslash `\`, as in bash
- **MUST** support limited escaping in double quotes: `\"`, `\$`, `` ` ``, `\\`, `\<newline>` only
  - `\"` becomes `"`
  - `\$` becomes `$`
  - `` \` `` becomes `` ` ``
  - `\\` becomes `\`
  - `\<newline>` becomes literal newline `\n`
  - Any other backslash sequence (e.g., `\X`) preserves the backslash: becomes `\X` (literal backslash + character)
- **MUST** replace `\<newline>` with newline to support multiline inputs
  - In double quotes: `\<newline>` becomes literal newline character
  - In unquoted: `\<newline>` becomes literal newline character (will split arguments as whitespace)
  - This is an allowed difference with bash
- **MUST NOT** interpret escape sequences like `\n`, `\t`, `\r` in double quotes (they are literal in bash, except `\<newline>` which is special)
- **MUST NOT** support any escaping in single quotes (single quotes are completely literal)
- **MUST** preserve backslashes in double quotes that don't form recognized escape sequences (e.g., `\a` becomes `\a`)
- Note: Bash only interprets `\n`, `\t`, etc. in `$'...'` (ANSI-C quoting), not in regular `"..."` quotes

### Whitespace Handling
- **MUST** split arguments on whitespace
- **MUST** treat any amount of whitespace as a single delimiter
- **MUST** preserve whitespace within quoted strings exactly
- **MUST** preserve newlines within quoted strings exactly (difference)
- **MUST** allow optional leading/trailing whitespace around the command (automatically handled by parser)
- **MUST NOT** include whitespace in argument values (whitespace is a delimiter, not content)
- **MUST** trim unquoted arguments (leading/trailing whitespace removed from unquoted argument values)
- Example: `arg1    arg2` → two arguments `arg1` and `arg2` (multiple spaces treated as single delimiter)

## Error Handling

### Invalid Syntax
- **MUST** detect unterminated quotes: `"unclosed string`
- **MUST** provide clear error message with position/context

## Common Patterns

### Subcommands
- **MUST** support subcommand pattern: `command subcommand [options] [args]`
  - treat as a regular positional argument for application logic to handle

## Typing
- **MUST** handle all positional arguments as strings

## Edge Cases

### Special Values
- **MUST** handle empty quoted arguments: `""` or `''` or ` `````` ` returns empty string `''` 
  - Empty strings are filtered out from the final argument array (empty quoted strings do not create array elements)
- **MUST** filter out empty unquoted arguments (whitespace-only unquoted arguments are removed)
- **MUST** filter out null, undefined, or empty string values from the final argument array

### Unicode and Special Characters
- **MUST** support UTF-8 in argument values
- **MUST** preserve Unicode characters exactly
- **SHOULD** handle file paths with spaces and special characters

## Output Format

### Parsed Result Structure
- **MUST** return a simple array of strings (positional arguments in order)
- **MUST** filter out empty arguments (null, undefined, or empty strings are excluded from the array)
- **MUST** handle all arguments as strings
- **MUST** preserve argument order
- Example: `"cmd arg1  arg2"` → `["cmd", "arg1", "arg2"]`

### API
- The parser exports a `parse(input)` function that takes a string and returns an array of argument strings
- The parser exports a `SyntaxError` class for error handling
- Usage: `import { parse, SyntaxError } from './command_parser.js'`

## PEGGY-Specific Considerations

### Grammar Structure
- **MUST** define grammar rules for:
  - `command`: top-level entry point (returns array of argument strings)
  - `argument`: unquoted or quoted string (single, double, or triple backtick quotes)
  - `quoted_triple_backtick`: triple backtick quotes with literal content
  - `quoted_single`: single quotes with literal content (no escaping)
  - `quoted_double`: double quotes with limited escaping
  - `unquoted`: unquoted argument with backslash escaping and trimming
- **MUST** use semantic actions to filter empty arguments and build result array
- **MUST** handle whitespace explicitly in grammar (optional leading/trailing, required between arguments)

### Error Reporting
- **MUST** leverage PEGGY's built-in error reporting (throws `SyntaxError`)
- **MUST** provide line/column information for syntax errors
- **MUST** include expected tokens in error messages
- Errors are thrown as exceptions that can be caught and presented to users/LLMs

### Performance
- **SHOULD** parse in single pass (PEG allows this)
- **SHOULD** avoid backtracking where possible
- **SHOULD** handle large argument lists efficiently
- **MUST** support multi-line commands (different)

## Testing Requirements

### Test Cases
- **MUST** test all MUST requirements
- **SHOULD** test all SHOULD requirements
- **SHOULD** include edge cases from Edge Cases section
- **SHOULD** test error cases from Error Handling section

### Example Test Cases
- Basic: `command arg1 arg2` → `["command", "arg1", "arg2"]`
- Quoted: `command "path with spaces" 'another path'` → `["command", "path with spaces", "another path"]`
- Escaped in double quotes: `command "say \"hello\""` → `["command", "say \"hello\""]`
- Single quotes (no escaping): `command 'it'\''s fine'` → `["command", "it's fine"]` (if bash-style quote concatenation is used)
- Single quotes (no escaping): `command "it's fine"` → `["command", "it's fine"]`
- Empty quoted: `command ""` → `["command"]` (empty string filtered out)
- Unicode: `command "José"` → `["command", "José"]`
- Backslash outside quotes: `command /path/to\ file` → `["command", "/path/to file"]`
- Literal escape sequences: `command "line1\nline2"` → `["command", "line1\\nline2"]` (literal backslash-n, not newline)
- Backslash-newline in double quotes: `command "line1\<newline>line2"` → `["command", "line1\nline2"]` (becomes actual newline)
- Backslash-newline unquoted: `command arg1\<newline>arg2` → `["command", "arg1", "arg2"]` (newline splits arguments)
- Unquoted trimming: `command  arg1  ` → `["command", "arg1"]` (leading/trailing whitespace trimmed from unquoted args)

## Implementation Notes

### Preprocessing
- **SHOULD** normalize line endings if reading from file
- **NOTE**: Triple backtick quoting (``` for multi-line content) is NOT bash behavior - bash uses backticks for command substitution. This is documented as a non-bash extension for multi-line content support.

### Current Implementation Status
- **IMPLEMENTED**: Positional arguments only (no flags/options)
- **IMPLEMENTED**: Single, double, and triple backtick quoting
- **IMPLEMENTED**: Backslash escaping in double quotes and unquoted
- **IMPLEMENTED**: Empty argument filtering
- **IMPLEMENTED**: Unquoted argument trimming
- **NOT IMPLEMENTED**: Flags, options, help system (see Future Implementation section)

### Error Reporting
- **MUST** throw `SyntaxError` exception on parse failures
- **MUST** provide error location information (line, column)
- **MUST** provide expected tokens in error messages
- The parser uses PEG.js/Peggy error reporting which provides structured error information

# Implementation Notes

### Backslash-Newline Handling
- Backslash-newline (`\<newline>`) is converted to a literal newline character
  - In double quotes: preserved as literal newline in the string value
  - In unquoted: becomes literal newline which acts as whitespace delimiter (splits arguments)
  - This differs from bash where backslash-newline outside quotes is a line continuation (removed during parsing)

# Future implementation

For now we only need positional arguments with good quoting, but later we can implement flags and options

- **MUST** support positional arguments after all flags/options: `command arg1 arg2`
- **MUST** allow positional arguments even when flags/options are present
- **SHOULD** support required vs optional positional arguments

### Flags (Boolean Options)
- **MUST** support short flags: `-a`, `-b`, `-c`
- **MUST** support long flags: `--verbose`, `--help`, `--version`
- **MUST** support flag combinations: `-abc` (equivalent to `-a -b -c`)
- **MUST** treat flags as boolean (present = true, absent = false)
- **SHOULD** support `--no-` prefix for explicit false: `--no-verbose`
- Note: Bash passes `-abc` as a single argument; this parser interprets it as application-level flag parsing

### Options (Value-Bearing Arguments)
- **MUST** support short options with space: `-f file.txt`
- **MUST** support long options with space: `--file file.txt`
- **MUST** support short options with equals: `-f=file.txt`
- **MUST** support long options with equals: `--file=file.txt`
- **MUST** distinguish between flags and options (options require values)
- **SHOULD** support multiple values for the same option: `--file a.txt --file b.txt`
- Note: Bash passes these as separate arguments; this parser interprets them as application-level option parsing

### Option Terminator
- **MUST** support `--` as option terminator (everything after is positional)
- **MUST** allow `--` to be used even when no options precede it
- Example: `command --flag -- --positional` (treats `--positional` as positional arg)

### Unknown Options
- **MUST** detect unknown flags/options
- **MUST** provide clear error message: "Unknown option: --unknown"
- **MAY** suggest similar option names (fuzzy matching)

### Missing Values
- **MUST** detect when option requires value but none provided: `--file` (no value)
- **MUST** provide clear error message: "Option --file requires a value"
- **MUST** handle end-of-args gracefully: `command --file` (last arg)

### Invalid Syntax
- **MUST** detect malformed option syntax: `--=value`, `-=value`

### Built-in Help
- **MUST** recognize `--help` and `-h` as help requests
- **SHOULD** recognize `help` as a subcommand
- **SHOULD** generate usage string from option definitions

### Usage String Format
- **SHOULD** follow POSIX/GNU conventions:
  - `[OPTIONS]` for optional flags/options
  - `<ARG>` for required positional arguments
  - `[ARG]` for optional positional arguments
  - `...` for variadic arguments
- **SHOULD** group options by category (e.g., "Common options", "Advanced options")
- **SHOULD** include option descriptions and default values

### Version
- **MUST** recognize `--version` and `-V` as version requests
- **SHOULD** display version string from configuration

### Options for Subcommands
- **SHOULD** allow different options per subcommand
- **SHOULD** support global options that apply before subcommand
- **SHOULD** support subcommand-specific help: `command subcommand --help`

### Negation
- **SHOULD** support `--no-` prefix for boolean flags: `--no-cache`
- **SHOULD** treat `--flag` and `--no-flag` as mutually exclusive
- **SHOULD** allow explicit true: `--flag=true` or `--flag=1`

### Counters
- **SHOULD** support count flags: `-vvv` (equivalent to `-v -v -v` or `--verbose=3`)
- **SHOULD** accumulate count across multiple occurrences: `-v -v` = count of 2

### Environment Variable Fallback
- **SHOULD** support reading options from environment variables
- **SHOULD** use naming convention: `--api-key` → `API_KEY` or `COMMAND_API_KEY`
- **SHOULD** prioritize command line args over environment variables

### Special Values
- **MUST** handle empty strings: `--file=""` or `--file ''` (empty quoted strings create empty argument values)
- **MUST** handle values that look like flags: `--file=--not-a-flag`
- **MUST** handle values starting with dashes: `--file=-/path/to/file`

### Parsed Result Structure (Future)
- **MUST** return structured object with:
  - `flags`: object mapping flag names to boolean values
  - `options`: object mapping option names to values (or arrays for multiple)
  - `positional`: array of positional arguments in order
  - `raw`: original argument array (for debugging)
- **SHOULD** normalize option names (e.g., `--file` and `-f` map to same key)
- **SHOULD** support custom key names (e.g., `--api-key` → `apiKey`)
- **SHOULD** handle all flags and arguments as strings, ignoring type

### Example Test Cases (Future)
- Basic: `command --flag -o value arg1 arg2`
- Combined flags: `command -abc`
- Quoted: `command --file "path with spaces" 'another path'`
- Escaped in double quotes: `command --message "say \"hello\""`
- Single quotes (no escaping): `command --message 'it'\''s fine'` or `command --message "it's fine"`
- Terminator: `command --flag -- --positional`
- Empty: `command --file=""` or `command ""`
- Unicode: `command --name "José"`
- Backslash outside quotes: `command --file /path/to\ file` → `/path/to file`
- Literal escape sequences: `command --message "line1\nline2"` → literal `\n`, not newline

### Preprocessing (Future)
- **SHOULD** handle shell expansion (if applicable) before parsing
