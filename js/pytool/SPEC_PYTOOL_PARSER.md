# Pytool Parser Specification

This document defines the requirements for parsing Python-style function call syntax used in `pytool` fenced code blocks. The parser is implemented with PEGGY (PEG parser generator). It parses function calls with positional string arguments — it is NOT a general Python parser and MUST NOT execute arbitrary Python code.

**Key Features:**
- Python function call syntax: `function_name("arg1", "arg2")`
- Multiple sequential calls per block
- Multiple blocks flattened into a single call list
- Python-compatible string literals (single, double, triple-quoted)
- Python-compatible escape sequences in double-quoted strings
- Positional arguments only (no keyword arguments)
- Upfront validation of function names before execution
- Structured error reporting via PEGGY

## Purpose

The pytool parser replaces the bash command parser for tool invocation. Instead of bash-style positional arguments:

```bash
docmem-create-node --append-child "abc123" "weather" "season" "summer" "Content"
```

Tools are invoked using Python function call syntax:

```pytool
docmem_create_node("append-child", "abc123", "weather", "season", "summer", "Content")
```

This syntax is cleaner, unambiguous, and more natural for LLMs trained on Python.

## Block Extraction

### Fenced Code Block Format

The agent loop MUST extract tool calls from `pytool` fenced code blocks in the model's response:

````
```pytool
function_name("arg1", "arg2")
```
````

The agent loop MUST:
- Recognize fenced code blocks with the `pytool` language identifier
- Extract the content between the opening and closing fences
- Pass the extracted content to the pytool parser

The agent loop MUST NOT:
- Require a `# Run` heading before the block
- Recognize `bash` or `exec` as valid tool block identifiers (those are separate systems)

### Multiple Blocks

- Multiple `pytool` blocks MAY appear in a single model response
- All calls from all blocks MUST be flattened into a single sequential list in document order
- Block boundaries have no semantic significance — they are equivalent to having all calls in one block

## Function Call Syntax

### Basic Structure

A function call MUST consist of:
- A function name (identifier)
- An opening parenthesis `(`
- Zero or more positional arguments separated by commas
- A closing parenthesis `)`

The parser MUST:
- Require parentheses even for zero-argument calls: `hello_world()` is valid
- Support multiple function calls per block, separated by newlines
- Allow optional whitespace around parentheses, commas, and between calls
- Allow optional trailing comma after the last argument: `func("a", "b",)`

The parser MUST NOT:
- Accept bare function names without parentheses: `hello_world` is invalid
- Accept keyword arguments: `func(key="value")` is invalid
- Accept expressions, variables, or any Python syntax beyond function calls with string literals
- Accept nested function calls: `func(other("x"))` is invalid

### Function Names

Function names MUST:
- Begin with a letter (a-z, A-Z) or underscore (`_`)
- Contain only letters, digits (0-9), underscores (`_`), and hyphens (`-`)
- Be preserved exactly as written (no normalization of hyphens to underscores or vice versa)

Hyphens are permitted in function names to maintain compatibility with existing command names (e.g., `docmem-create` and `docmem_create` are both valid and treated as distinct names).

### Arguments

All arguments MUST be string literals. The parser MUST:
- Accept only quoted string arguments (single, double, or triple-quoted)
- Return all arguments as JavaScript strings
- NOT accept unquoted arguments, numbers, booleans, or other Python literals
- Preserve the order of arguments exactly as provided

## String Literals

All four string literal types support the same escape sequences, matching Python behavior. The only difference between quote types is which delimiter closes the string. Each type also has a raw variant (prefixed with `r`) that disables escape processing.

### Escape Sequences

The parser MUST support these escape sequences in all non-raw string types:
- `\\` becomes `\` (backslash)
- `\'` becomes `'` (single quote)
- `\"` becomes `"` (double quote)
- `\n` becomes newline (U+000A)
- `\t` becomes tab (U+0009)
- `\r` becomes carriage return (U+000D)
- `\0` becomes null character (U+0000)
- `\a` becomes bell (U+0007)
- `\b` becomes backspace (U+0008)
- `\f` becomes form feed (U+000C)
- `\v` becomes vertical tab (U+000B)

The parser MUST:
- Preserve unrecognized escape sequences literally (backslash included): `\z` remains `\z`

The parser MUST NOT:
- Support `\x`, `\u`, `\U`, or `\N` Unicode escape sequences (these MAY be added later)
- Perform string interpolation or f-string processing

### Single Quotes (`'...'`)

The parser MUST:
- Support single-quote delimited strings with escape sequence processing
- Allow double quotes inside without escaping: `'say "hello"'`
- Require `\'` to include a single quote: `'it\'s fine'`
- Preserve newlines within the string

### Double Quotes (`"..."`)

The parser MUST:
- Support double-quote delimited strings with escape sequence processing
- Allow single quotes inside without escaping: `"it's fine"`
- Require `\"` to include a double quote: `"say \"hello\""`
- Preserve newlines within the string

### Triple Double Quotes (`"""..."""`)

The parser MUST:
- Support exactly three consecutive double-quote characters as delimiters
- Process escape sequences (same as single and double quotes)
- Allow single quotes, double quotes (up to two consecutive), and newlines without escaping
- Close only on three consecutive unescaped double quotes

### Triple Single Quotes (`'''...'''`)

The parser MUST:
- Support exactly three consecutive single-quote characters as delimiters
- Process escape sequences (same as single and double quotes)
- Allow double quotes, single quotes (up to two consecutive), and newlines without escaping
- Close only on three consecutive unescaped single quotes

### Raw Strings (`r'...'`, `r"..."`, `r"""..."""`, `r'''...'''`)

The parser MUST:
- Support the `r` prefix (lowercase only) before any of the four quote types
- Disable all escape sequence processing in raw strings — backslashes are literal
- Otherwise follow the same delimiter rules as the non-raw variant

The parser MUST NOT:
- Support uppercase `R` prefix or mixed-case variants (`R"..."`, `Rb"..."`)
- Support other string prefixes (`b`, `f`, `u`)

Raw strings are useful for content containing literal backslashes (file paths, regex patterns, raw text) where double-escaping would be cumbersome.

### Empty Strings

The parser MUST:
- Accept empty string arguments in all variants: `func("")`, `func('')`, `func("""""")`, `func(r"")`
- Preserve empty strings in the argument list (they are valid arguments, unlike the bash parser)
- An empty string is a meaningful value (e.g., empty content for a docmem node)

## Whitespace Handling

The parser MUST:
- Allow optional whitespace (spaces, tabs) before and after each function call
- Allow blank lines between function calls
- Allow optional whitespace around parentheses: `func ( "a" , "b" )`
- Allow optional whitespace around commas
- Allow newlines within argument lists (arguments may span multiple lines)
- Ignore leading and trailing whitespace in the block

## Output Format

### Parsed Result Structure

The `parse()` function MUST:
- Accept a string containing one or more function calls
- Return an array of call objects, each containing:
  - `name`: The function name as a string (preserved exactly as written)
  - `args`: An array of string argument values (in order, escape sequences processed)
- Return an empty array `[]` for input containing only whitespace or empty input

Each call object produces a flat array for the command router where the function name is `args[0]`:
- `func_name("a", "b")` produces `["func_name", "a", "b"]`
- `hello_world()` produces `["hello_world"]`

### API

The generated parser MUST:
- Export a `parse(input)` function
- Return an array of `{ name: string, args: string[] }` objects
- Throw PEGGY's `SyntaxError` on parse failures with structured error information:
  - `message`: Human-readable error description
  - `location`: Object with `start` and `end` positions (line, column, offset)
  - `expected`: Array of expected tokens at the error position
  - `found`: The actual text found at the error position

## Execution Model

### Call List Construction

The interpreter MUST:
- Collect all `pytool` blocks from the model response in document order
- Parse each block independently
- Flatten all parsed calls into a single sequential list

### Upfront Validation

Before executing any calls, the interpreter MUST:
- Check every function name in the call list against the set of registered tool names
- If any function name is unknown, reject the entire list without executing any calls
- Return an error message listing the unknown function name(s)
- The error message MUST be actionable (tell the model which name was invalid and what names are available)

### Sequential Execution

After validation passes, the interpreter MUST:
- Execute calls sequentially in list order
- Each call receives the flat array `[name, ...args]`
- Collect the result of each call
- If a call fails (returns an error), stop execution and do not execute remaining calls
- Return all results (successes and the final error) to the model

### Command Router Compatibility

The interpreter MUST pass calls to the existing command router as flat arrays:
- `docmem_create_node("append-child", "abc123", "w", "s", "v", "text")` becomes `["docmem_create_node", "append-child", "abc123", "w", "s", "v", "text"]`
- The command router receives `args[0]` as the command name and `args.slice(1)` as arguments
- The command router MUST accept both hyphenated and underscored function names

## System Prompt Integration

### Tool Documentation Format

When building the system prompt, available tools MUST be described using Python function signature syntax:

```
def docmem_create_node(mode: str, node_id: str, context_type: str, context_name: str, context_value: str, content: str):
    """Creates a new node at the specified position relative to an existing node.

    mode: "append-child", "before", or "after"
    node_id: existing node ID to position relative to
    context_type: string 0-24 chars
    context_name: string 0-24 chars
    context_value: string 0-24 chars
    content: text content (may be empty "")
    """
```

- Type annotations (`: str`) are documentation only — the parser MUST NOT enforce types
- Type annotations are optional in the signature
- The docstring provides parameter descriptions and usage guidance
- The system prompt MUST list all available tools using this format

## Comments

The parser MUST:
- Support line comments starting with `#`
- Ignore everything from `#` to the end of the line
- Allow comments on their own line (with optional leading whitespace)
- Allow comments after a function call on the same line: `func("a")  # create node`
- NOT treat `#` inside string literals as comments

## PEGGY Grammar Structure

The implementation MUST define grammar rules for:
- `block`: top-level entry point (returns array of call objects)
- `function_call`: a single function invocation
- `function_name`: identifier allowing letters, digits, underscores, and hyphens
- `argument_list`: comma-separated string literals within parentheses
- `string_literal`: normal or raw, single/double/triple-single/triple-double quoted
  - `raw_string`: `r` prefix followed by any quote type, literal content (no escape processing)
  - `triple_double_quoted`: `"""..."""` with escape sequence handling
  - `triple_single_quoted`: `'''...'''` with escape sequence handling
  - `single_quoted`: `'...'` with escape sequence handling
  - `double_quoted`: `"..."` with escape sequence handling
- `escape_sequence`: Python escape sequences (shared by all non-raw string types)
- `raw_content`: literal characters up to the closing delimiter (shared by all raw string types)
- `comment`: `#` to end of line
- `separator`: whitespace, newlines, and comments between function calls

The implementation MUST:
- Check triple-quote delimiters before single/double quote delimiters (longest match first)
- Use semantic actions to build call objects with name and args arrays
- Handle whitespace, newlines, and comments explicitly in grammar rules
- Share the escape sequence rule across all string types

## Error Handling

### Parse Errors

The parser MUST:
- Detect unterminated strings (all quote types)
- Detect missing closing parenthesis
- Detect invalid characters in function names
- Detect missing commas between arguments
- Throw `SyntaxError` with line and column information (1-indexed)

### Common Error Scenarios

- Unterminated string: `func("unclosed` — error at end of input
- Missing closing paren: `func("a", "b"` — error at end of input
- Bare word argument: `func(hello)` — error at `h` (expected string literal)
- Keyword argument: `func(key="val")` — error at `=`
- Missing parens: `func_name` — error at end of input (expected `(`)
- Non-string argument: `func(123)` — error at `1` (expected string literal)

## Unicode Support

The parser MUST:
- Support UTF-8 encoded characters in string values
- Preserve Unicode characters exactly as provided
- Handle multi-byte characters correctly (emoji, CJK, accented characters)

## Performance

The parser SHOULD:
- Parse input in a single pass
- Minimize backtracking by ordering grammar rules appropriately
- Handle large argument values efficiently

The parser MUST:
- Complete parsing in reasonable time for typical block sizes (< 10000 characters)
- Not have exponential time complexity for any input patterns

## Testing Requirements

### Test Cases

Test suites MUST:
- Test single function calls with varying argument counts (0, 1, many)
- Test multiple function calls in one block
- Test all string literal types (single, double, triple-double, triple-single)
- Test raw string variants (`r"..."`, `r'...'`, `r"""..."""`, `r'''...'''`)
- Test escape sequences in all four non-raw string types
- Test that raw strings preserve backslashes literally
- Test empty string arguments (including raw: `r""`)
- Test function names with hyphens and underscores
- Test whitespace handling (around parens, commas, between calls)
- Test trailing comma handling
- Test multi-line argument lists (with inline comments between args)
- Test Unicode content in strings
- Test line comments (standalone, inline after call, inline between args, not inside strings)
- Test all error cases (unterminated strings, missing parens, bare words, etc.)

### Example Test Cases

**Single calls:**
- `hello_world()` — `[{ name: "hello_world", args: [] }]`
- `docmem_create("my-doc")` — `[{ name: "docmem_create", args: ["my-doc"] }]`
- `docmem-create("my-doc")` — `[{ name: "docmem-create", args: ["my-doc"] }]`

**Multiple calls:**
```
docmem_create("my-doc")
docmem_create_node("append-child", "my-doc", "t", "n", "v", "content")
```
Returns two call objects in order.

**String types (all process escapes identically):**
- `func("hello")` — double quoted: `["hello"]`
- `func('hello')` — single quoted: `["hello"]`
- `func("line1\nline2")` — `["line1\nline2"]` (actual newline)
- `func('line1\nline2')` — `["line1\nline2"]` (actual newline, same behavior)
- `func("""line1\nline2""")` — `["line1\nline2"]` (actual newline, same behavior)
- `func('''line1\nline2''')` — `["line1\nline2"]` (actual newline, same behavior)

**Escape sequences (all string types):**
- `func("tab\there")` — `["tab\there"]` (actual tab)
- `func("say \"hello\"")` — `["say \"hello\""]` (escaped quotes)
- `func('it\'s fine')` — `["it's fine"]` (escaped single quote)
- `func("back\\slash")` — `["back\\slash"]` (escaped backslash)
- `func("unknown\z")` — `["unknown\\z"]` (unrecognized escape preserved)

**Raw strings (backslashes are literal):**
- `func(r"hello\nworld")` — `["hello\\nworld"]` (literal backslash-n, no newline)
- `func(r'C:\Users\name')` — `["C:\\Users\\name"]` (backslashes preserved)
- `func(r"""multi\nline""")` — `["multi\\nline"]` (literal)
- `func(r'''multi\nline''')` — `["multi\\nline"]` (literal)
- `func(r"")` — `[""]` (empty raw string)

**Empty strings:**
- `func("")` — `[{ name: "func", args: [""] }]` (empty string preserved)
- `func('', "")` — `[{ name: "func", args: ["", ""] }]` (both preserved)

**Whitespace:**
- `func( "a" , "b" )` — `[{ name: "func", args: ["a", "b"] }]`
- `func("a", "b",)` — trailing comma allowed

**Multi-line argument list with inline comments:**
```
docmem_create_node(
    "append-child",  # position mode
    "abc123",        # target node
    "weather",       # context type
    "season",        # context name
    "summer",        # context value
    "Content here"
)
```
Returns one call with six args (comments ignored).

**Comments:**
- `# this is a comment` — `[]` (no calls)
- `func("a")  # inline comment` — `[{ name: "func", args: ["a"] }]`
- `func("has # in it")` — `[{ name: "func", args: ["has # in it"] }]` (`#` inside string is not a comment)
```
# Step 1: create the docmem
docmem_create("my-doc")
# Step 2: add a node
docmem_create_node("append-child", "my-doc", "t", "n", "v", "content")
```
Returns two call objects (comments ignored).

**Errors:**
- `func("unclosed` — SyntaxError (unterminated string)
- `func(hello)` — SyntaxError (bare word, expected string literal)
- `func("a" "b")` — SyntaxError (missing comma)
- `hello_world` — SyntaxError (missing parentheses)
- `func(key="val")` — SyntaxError (keyword argument not supported)

## Differences from Python

This parser intentionally differs from Python in several ways:

**Restrictions (Python features not supported):**
- No keyword arguments (`key=value`)
- No expressions, variables, or identifiers as arguments
- No numeric, boolean, None, or other non-string literals
- No nested function calls
- No list, dict, tuple, or set literals
- No string concatenation or f-strings
- No `\x`, `\u`, `\U`, `\N` Unicode escapes (may be added later)
- No imports, assignments, or control flow

**Extensions (not standard Python):**
- Hyphens allowed in function names: `docmem-create("id")`

**Identical to Python:**
- Single quote string literals (with escape sequences)
- Double quote string literals (with escape sequences)
- Triple-quoted strings (both `"""` and `'''`, with escape sequences)
- Raw string prefix `r` (disables escape processing)
- Escape sequence behavior (same set of recognized escapes)
- Parenthesized argument lists with comma separation
- Trailing comma permitted
- Line comments with `#`

## Implementation Notes

- The parser is implemented as a PEGGY grammar compiled to a JavaScript ES module
- The generated parser file MUST NOT be edited manually — regenerate from the `.pegjs` source
- The parser handles raw input strings only — no preprocessing required
- The block extraction (finding `pytool` fenced blocks in model output) is handled by the agent loop, not by this parser
- The parser receives only the content between the fences
