# Command Line Parsing Specification

This document defines the requirements for command line argument parsing, designed for implementation with PEGGY (PEG parser generator). The parser provides bash-compatible argument parsing with extensions for multi-line input support (triple quotes). It handles quoting, escaping, and whitespace splitting while maintaining simplicity by supporting only positional arguments (no flags or options in the current implementation).

**Key Features:**
- Positional argument parsing
- Three quote types: single (`'...'`), double (`"..."`), and triple (`"""..."""`)
- Bash-compatible escaping with limited extensions
- Multi-line input support
- Unicode support
- Structured error reporting

## Basic Syntax

### Positional Arguments
The parser **MUST**:
- Parse all arguments as positional arguments (no flags or options in current implementation)
- Preserve the exact order of arguments as provided in the input
- Return arguments in a sequential array (first argument at index 0)
- Treat the first argument the same as subsequent arguments (no special command handling)

Examples:
- `command arg1 arg2 arg3` → `["command", "arg1", "arg2", "arg3"]`
- `arg1 arg2 arg3` → `["arg1", "arg2", "arg3"]` (no special first element)
- `"arg 1" "arg 2"` → `["arg 1", "arg 2"]` (order preserved)

## Quoting and Escaping

### String Quoting

#### Single Quotes (`'...'`)
The parser **MUST**:
- Support single quotes for literal string values
- Preserve all content within single quotes exactly (completely literal)
- NOT support any escape sequences (all characters literal, including backslashes)
- Remove the single quote delimiters from the final argument value
- Preserve newlines within single quotes (multi-line support)
- Preserve double quotes within single quotes literally: `'say "hello"'` → `say "hello"`

The parser **MUST NOT**:
- Interpret backslashes as escape characters: `'it\'s'` is invalid (terminates at first `'`)
- Support quote concatenation: `'a''b'` is two arguments, not one

#### Double Quotes (`"..."`)
The parser **MUST**:
- Support double quotes for string values with limited escaping
- Preserve content within double quotes (with escape processing)
- Support only these escape sequences: `\"`, `\$`, `` \` ``, `\\`, `\<newline>`
- Preserve unrecognized escape sequences literally (backslash included): `\n` → `\n`
- Remove the double quote delimiters from the final argument value
- Preserve newlines within double quotes (multi-line support)
- Preserve single quotes within double quotes literally: `"it's fine"` → `it's fine`

The parser **MUST NOT**:
- Perform shell expansion (no variable substitution, no command substitution)
- Interpret ANSI-C escape sequences like `\n`, `\t` as special (they remain literal `\n`, `\t`)

#### Triple Quotes (`"""..."""`)
The parser **MUST**:
- Support exactly three consecutive double-quote characters as delimiters
- Preserve all content within triple quotes exactly (completely literal)
- NOT support any escape sequences (all characters literal, including backslashes)
- Remove the triple quote delimiters from the final argument value
- Preserve newlines within triple quotes (multi-line support)
- Preserve single quotes, double quotes, and backticks literally within triple quotes
  - Example: `"""Say'n "hello" with `backticks` """` → `Say'n "hello" with `backticks` `

The parser **MUST NOT**:
- Allow escaping triple quotes within triple quotes
- Support nesting triple quotes (the next `"""` always closes the block)
- Interpret any escape sequences (even `\` followed by `"""`)

**Important Notes:**
- Triple quotes are NOT bash syntax (this is an extension for multi-line input)
- Triple backticks (` ``` `) have no special meaning (they are literal characters)
- Only ASCII quote characters are recognized (no Unicode quote variants)

### Escaping

#### Unquoted Context
- **MUST** support backslash escaping: `\` followed by any character removes the backslash and preserves the character
  - `\X` becomes `X` (backslash removed, character `X` preserved)
  - `\\` becomes `\` (double backslash becomes single backslash)
  - `\ ` becomes ` ` (escaped space becomes space, doesn't split arguments)
  - `\<newline>` becomes literal newline character (acts as whitespace, splits arguments)

#### Double Quote Context
- **MUST** support limited escaping: only `\"`, `\$`, `` \` ``, `\\`, `\<newline>` are recognized escape sequences
  - `\"` becomes `"` (escaped quote)
  - `\$` becomes `$` (escaped dollar sign)
  - `` \` `` becomes `` ` `` (escaped backtick)
  - `\\` becomes `\` (escaped backslash)
  - `\<newline>` becomes literal newline character (preserved in string value)
  - Any other backslash sequence (e.g., `\X`, `\a`, `\n`, `\t`) **MUST** preserve the backslash: becomes `\X`, `\a`, `\n`, `\t` (literal backslash + character)
- **MUST NOT** interpret escape sequences like `\n`, `\t`, `\r` as special characters (they remain literal `\n`, `\t`, `\r`)
  - Note: Bash only interprets `\n`, `\t`, etc. in `$'...'` (ANSI-C quoting), not in regular `"..."` quotes

#### Single Quote Context
- **MUST NOT** support any escaping (single quotes are completely literal)
- All characters including backslashes are preserved exactly as-is
- There is no way to include a single quote inside single quotes in this implementation

#### Triple Quote Context
- **MUST NOT** support any escaping (triple quotes are completely literal)
- All characters including backslashes, single quotes, and double quotes are preserved exactly as-is
- There is no way to include triple quotes (""") inside triple quotes

### Whitespace Handling
Whitespace characters include: space (` `), tab (`\t`), newline (`\n`), and carriage return (`\r`).

The parser **MUST**:
- Split arguments on one or more whitespace characters
- Treat any amount of consecutive whitespace as a single delimiter between arguments
- Preserve all whitespace (including newlines) within quoted strings exactly
  - Single quotes: all whitespace preserved literally
  - Double quotes: all whitespace preserved literally (except `\<newline>` escape sequence)
  - Triple quotes: all whitespace preserved literally (no escaping)
- Allow optional leading whitespace before the first argument
- Allow optional trailing whitespace after the last argument
- Require at least one whitespace character between adjacent arguments
- Trim unquoted arguments: remove leading and trailing whitespace from unquoted argument values
  - If an unquoted argument becomes empty after trimming, it **MUST** be filtered out
- NOT include whitespace in unquoted argument values (whitespace is a delimiter, not content)

Examples:
- `arg1    arg2` → `["arg1", "arg2"]` (multiple spaces treated as single delimiter)
- `  arg1  ` → `["arg1"]` (leading/trailing whitespace removed)
- `"  arg1  "` → `["  arg1  "]` (whitespace preserved in quotes)
- `arg1\narg2` → `["arg1", "arg2"]` (unescaped newline splits arguments)

## Error Handling

### Invalid Syntax
- **MUST** detect unterminated single quotes: `'unclosed string`
- **MUST** detect unterminated double quotes: `"unclosed string`
- **MUST** detect unterminated triple quotes: `"""unclosed string`
- **MUST** throw `SyntaxError` exception with parse failure information
- **MUST** provide error location information (line, column) from PEGGY's error reporting
- **MUST** provide expected tokens in error messages from PEGGY's error reporting

## Common Patterns

### Subcommands
The parser **MUST**:
- Support subcommand pattern: `command subcommand [args...]`
- Treat subcommands as regular positional arguments (no special parsing)
- Leave subcommand interpretation to application logic

The parser does NOT:
- Distinguish between commands and subcommands
- Parse different argument structures based on subcommands
- Provide special handling for subcommand help or validation

Examples:
- `git commit -m "message"` → `["git", "commit", "-m", "message"]` (all positional)
- `docker run nginx` → `["docker", "run", "nginx"]` (all positional)
- Application logic must inspect the positional array to identify subcommands

## Typing
The parser **MUST**:
- Return all arguments as JavaScript strings (primitive string type)
- NOT attempt type conversion (numbers remain strings, boolean-like values remain strings)
- NOT interpret special values like "true", "false", "null", "undefined" (they are strings)

Examples:
- `command 123` → `["command", "123"]` (number as string)
- `command true` → `["command", "true"]` (boolean as string)
- `command null` → `["command", "null"]` (null keyword as string)

## Edge Cases

### Special Values

#### Empty Strings
The parser **MUST**:
- Parse empty quoted strings: `""`, `''`, or `""""""` as empty string values
- Filter out empty string values from the final argument array
  - Empty quoted strings do NOT create array elements in the result
- Filter out null and undefined values from the final argument array
- Filter out whitespace-only unquoted arguments (they are trimmed to empty string, then filtered)

Examples:
- `command ""` → `["command"]` (empty double quotes filtered out)
- `command ''` → `["command"]` (empty single quotes filtered out)
- `command """"""` → `["command"]` (empty triple quotes filtered out)
- `command "" arg` → `["command", "arg"]` (empty string between arguments filtered out)
- `command   ` → `["command"]` (trailing whitespace-only argument filtered out)

### Unicode and Special Characters
The parser **MUST**:
- Support UTF-8 encoded characters in argument values
- Preserve Unicode characters exactly as provided in the input
- Handle multi-byte Unicode characters correctly (e.g., emoji, accented characters)
- Treat Unicode whitespace characters as literal characters (only ASCII space, tab, newline, carriage return are delimiters)

The parser **SHOULD**:
- Handle file paths with spaces (via quoting or escaping)
- Handle file paths with special characters (via quoting or escaping)

Examples:
- `command "José"` → `["command", "José"]` (accented character preserved)
- `command "Hello 👋"` → `["command", "Hello 👋"]` (emoji preserved)
- `command "文字"` → `["command", "文字"]` (CJK characters preserved)
- `command "/path/with\ spaces/file.txt"` → `["command", "/path/with spaces/file.txt"]` (escaped space in path)

## Output Format

### Parsed Result Structure
The `parse()` function **MUST**:
- Return a JavaScript array of strings (positional arguments in order)
- Filter out empty arguments (null, undefined, or empty strings excluded from array)
- Return all arguments as primitive string type
- Preserve the order of arguments exactly as provided
- Return an empty array `[]` for input containing only whitespace or empty strings
- Return an empty array `[]` for empty string input `""`

The result array:
- Has numeric indices starting at 0
- Contains only non-empty string values
- Preserves whitespace within string values (from quoted arguments)
- Does NOT contain the quote delimiters (quotes are removed)
- Does NOT contain escape backslashes (backslashes are processed)

Examples:
- `"cmd arg1  arg2"` → `["cmd", "arg1", "arg2"]`
- `""` → `[]` (empty input)
- `"  "` → `[]` (whitespace only)
- `"cmd '' arg"` → `["cmd", "arg"]` (empty quotes filtered)
- `"cmd 'a' 'b' 'c'"` → `["cmd", "a", "b", "c"]`

### API
The generated parser **MUST**:
- Export a `parse(input)` function that takes a command string and returns an array of argument strings
- Throw PEGGY's `SyntaxError` class on parse failures with structured error information including:
  - `message`: Human-readable error description
  - `location`: Object with line and column information (`start` and `end` positions)
  - `expected`: Array of expected tokens at the error position
  - `found`: The actual text found at the error position
- Accept multi-line input strings (newlines within quoted strings are preserved)
- Return an empty array `[]` for input that contains only whitespace or empty strings

## PEGGY-Specific Considerations

### Grammar Structure
The implementation **MUST** define grammar rules for:
  - `command`: top-level entry point (returns array of argument strings)
  - `argument`: unquoted or quoted string (single, double, or triple quote blocks)
  - `quoted_triple_quote`: triple quote blocks (""") with literal content
    - `triple_quote_content`: content within triple quotes
    - `triple_quote_char`: any character that's not three consecutive double quotes
  - `quoted_single`: single quotes with literal content (no escaping)
    - `single_quote_content`: content within single quotes
    - `single_quote_char`: any character except single quote
  - `quoted_double`: double quotes with limited escaping
    - `double_quote_content`: content within double quotes
    - `double_quote_char`: characters with escape sequence handling
  - `unquoted`: unquoted argument with backslash escaping and trimming
    - `unquoted_char`: characters with backslash escape handling
  - `whitespace`: one or more whitespace characters (space, tab, newline, carriage return)

The implementation **MUST**:
- Use semantic actions to filter empty arguments (null, undefined, empty string) and build result array
- Handle whitespace explicitly in grammar (optional leading/trailing, required between arguments)
- Return null for empty unquoted arguments after trimming (which are then filtered out)

### Error Reporting (PEGGY-Specific)
The PEGGY-generated parser **MUST**:
- Leverage PEGGY's built-in error reporting (automatically generated)
- Throw `SyntaxError` exceptions on parse failures
- Provide structured error information including:
  - Line and column numbers (1-indexed)
  - Expected tokens at the error position
  - Found text at the error position
- Allow errors to be caught and handled by the calling application
- Support error presentation to users or LLMs (structured error objects)

### Performance
The parser **SHOULD**:
- Parse input in a single pass (PEG parsing allows this)
- Minimize backtracking by ordering grammar rules appropriately:
  - Triple quotes checked first (longest delimiter)
  - Single quotes checked second
  - Double quotes checked third
  - Unquoted checked last (fallback)
- Handle large argument lists efficiently (linear time complexity)
- Handle large string values efficiently (no unnecessary copying)

The parser **MUST**:
- Support multi-line commands (newlines within quoted strings preserved)
- Complete parsing in reasonable time for typical command lengths (< 1000 characters)
- Not have exponential time complexity for any input patterns

## Testing Requirements

### Test Cases
Test suites **MUST**:
- Test all MUST requirements from this specification
- Cover all quoting types (single, double, triple)
- Cover all escape sequences (unquoted and double quote contexts)
- Cover empty string handling (quoted and unquoted)
- Cover whitespace handling (splitting, trimming, preservation)
- Cover multi-line inputs (newlines within quotes)
- Cover Unicode and special characters
- Test error cases (unterminated quotes, invalid syntax)

Test suites **SHOULD**:
- Test all SHOULD requirements from this specification
- Include edge cases from the Edge Cases section
- Test boundary conditions (empty input, very long strings)
- Test combinations of quoting types in single command
- Test performance with large inputs (stress testing)
- Provide clear test descriptions and expected outcomes

Test format **SHOULD**:
- Use input/output pairs with clear expected results
- Group tests by feature category (quoting, escaping, whitespace, etc.)
- Include both positive tests (valid input) and negative tests (error cases)
- Provide test names that describe what is being tested

### Example Test Cases
- Basic: `command arg1 arg2` → `["command", "arg1", "arg2"]`
- Quoted: `command "path with spaces" 'another path'` → `["command", "path with spaces", "another path"]`
- Escaped in double quotes: `command "say \"hello\""` → `["command", "say \"hello\""]`
- Single quotes preserve quotes inside doubles: `command "it's fine"` → `["command", "it's fine"]`
- Double quotes preserve quotes inside singles: `command 'say "hello"'` → `["command", "say \"hello\""]`
- Triple quotes preserve everything: `command """it's "fine" here"""` → `["command", "it's \"fine\" here"]`
- Empty quoted: `command ""` → `["command"]` (empty string filtered out)
- Empty triple quoted: `command """"""` → `["command"]` (empty string filtered out)
- Unicode: `command "José"` → `["command", "José"]`
- Backslash outside quotes: `command /path/to\ file` → `["command", "/path/to file"]`
- Double backslash outside quotes: `command path\\file` → `["command", "path\file"]`
- Literal escape sequences: `command "line1\nline2"` → `["command", "line1\\nline2"]` (literal backslash-n, not newline)
- Backslash-newline in double quotes: `command "line1\<actual newline>line2"` → `["command", "line1\nline2"]` (becomes actual newline)
- Backslash-newline unquoted: `command arg1\<actual newline>arg2` → `["command", "arg1", "arg2"]` (newline splits arguments)
- Unquoted trimming: `command  arg1  ` → `["command", "arg1"]` (leading/trailing whitespace trimmed from unquoted args)
- Multiline single quote: `command 'line1<newline>line2'` → `["command", "line1\nline2"]` (newlines preserved)
- Multiline double quote: `command "line1<newline>line2"` → `["command", "line1\nline2"]` (newlines preserved)
- Multiline triple quote: `command """line1<newline>line2"""` → `["command", "line1\nline2"]` (newlines preserved)

## Implementation Notes

### Preprocessing
Applications using this parser **SHOULD**:
- Accept input strings as-is without preprocessing
- Optionally normalize line endings before parsing if reading from files with mixed line endings
- NOT attempt to preprocess escape sequences (the parser handles all escaping)

**Important Notes:**
- Triple quote quoting (`"""..."""` for multi-line content) is NOT standard bash behavior
  - This is an intentional extension for multi-line content support
  - Bash does not have a triple-quote syntax
- Triple backticks (` ``` `) do NOT work for multi-line values
  - Use triple quotes (`"""..."""`) instead
  - Backticks have no special meaning in this parser (they are literal characters)
- The parser handles raw input strings directly (no shell expansion, no variable substitution)

### Differences from Bash
This parser intentionally differs from bash in several ways:

**Extensions (features not in bash):**
- Triple quote syntax (`"""..."""`) for multi-line literal strings
- Preserves newlines within all quote types (bash may handle differently in some contexts)

**Simplifications (bash features not implemented):**
- No shell expansion (variables like `$VAR`, command substitution like `$(cmd)`, etc.)
- No brace expansion (`{a,b,c}`)
- No tilde expansion (`~/path`)
- No glob patterns (`*.txt`)
- No ANSI-C quoting (`$'...'` with `\n`, `\t`, etc.)
- No quote concatenation (`'a'b'c'` → `abc`)
- No history expansion (`!123`)
- Backslash-newline in unquoted context becomes literal newline (bash removes it as line continuation)

**Identical to bash:**
- Single quote behavior (completely literal, no escaping)
- Double quote behavior (limited escaping: `\"`, `\$`, `` \` ``, `\\`, `\<newline>`)
- Unquoted backslash escaping (removes backslash, preserves next character)
- Whitespace argument splitting
- Empty argument filtering

### Current Implementation Status
The current implementation includes:
- ✅ **IMPLEMENTED**: Positional arguments only (no flags/options)
- ✅ **IMPLEMENTED**: Single quotes (`'...'`) with completely literal content (no escaping)
- ✅ **IMPLEMENTED**: Double quotes (`"..."`) with limited escaping (`\"`, `\$`, `` \` ``, `\\`, `\<newline>`)
- ✅ **IMPLEMENTED**: Triple quotes (`"""..."""`) with completely literal content (no escaping)
- ✅ **IMPLEMENTED**: Backslash escaping in unquoted context (all characters)
- ✅ **IMPLEMENTED**: Backslash escaping in double quotes (limited set)
- ✅ **IMPLEMENTED**: Empty argument filtering (null, undefined, empty string)
- ✅ **IMPLEMENTED**: Unquoted argument trimming (leading/trailing whitespace removed)
- ✅ **IMPLEMENTED**: Multiline support within quoted strings (newlines preserved)
- ✅ **IMPLEMENTED**: Whitespace argument splitting (space, tab, newline, carriage return)
- ❌ **NOT IMPLEMENTED**: Flags/options parsing (see Future Implementation section)
- ❌ **NOT IMPLEMENTED**: Built-in help system (see Future Implementation section)
- ❌ **NOT IMPLEMENTED**: Quote concatenation (bash allows `'a'b'c'` → `abc`, this parser doesn't)

### Error Reporting
The parser **MUST**:
- Throw PEGGY's `SyntaxError` exception class on parse failures
- Provide structured error information in the exception object with:
  - `message`: Human-readable error description
  - `location`: Object containing:
    - `start`: Object with `line`, `column`, and `offset` of error start position
    - `end`: Object with `line`, `column`, and `offset` of error end position
  - `expected`: Array of expected token descriptions at the error position
  - `found`: String describing the actual text found at the error position (or null if end of input)
- Use PEGGY's built-in error reporting (automatically generated)
- Provide line and column numbers starting from 1 (not 0-indexed)

**Common Error Scenarios:**
- Unterminated single quote: throws error at end of input or closing delimiter
- Unterminated double quote: throws error at end of input or closing delimiter
- Unterminated triple quote: throws error at end of input (expecting `"""`)
- Unexpected characters: typically won't error, parsed as unquoted arguments

# Implementation Notes

### Backslash-Newline Handling
The parser **MUST** convert backslash-newline (`\` followed by actual newline character) to a literal newline character:

**In Double Quotes:**
- `\<newline>` **MUST** become a literal newline character (`\n`)
- The newline **MUST** be preserved as part of the string value
- Example: `"line1\<actual newline>line2"` → `"line1\nline2"` (actual newline in the string)

**In Unquoted Context:**
- `\<newline>` **MUST** become a literal newline character
- The newline **MUST** act as whitespace (argument delimiter)
- This **MUST** split the argument at that position
- Example: `arg1\<actual newline>arg2` → `["arg1", "arg2"]` (two separate arguments)

**Difference from Bash:**
- Bash treats backslash-newline outside quotes as line continuation (the backslash and newline are removed entirely)
- This parser treats it as a literal newline character (whitespace delimiter)
- This is an intentional difference to support multi-line input

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
