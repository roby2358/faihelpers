{
  // Pytool parser - Python-style function call syntax
  // Parses function calls with positional string arguments
  // Generated parser: do not edit pytool_parser.js manually
}

block
  = _ calls:(call:function_call _ { return call; })* { return calls; }

function_call
  = name:function_name _ "(" _ args:argument_list? _ ")" {
      return { name, args: args || [] };
    }

function_name
  = first:[a-zA-Z_] rest:[a-zA-Z0-9_\-]* { return first + rest.join(''); }

argument_list
  = first:string_literal rest:(_ "," _ arg:string_literal { return arg; })* (_ ",")? {
      return [first, ...rest];
    }

// String literals — order matters: raw triples, triples, raw singles, singles
string_literal
  = raw_triple_double_quoted
  / raw_triple_single_quoted
  / raw_double_quoted
  / raw_single_quoted
  / triple_double_quoted
  / triple_single_quoted
  / double_quoted
  / single_quoted

// ─── Raw strings (r prefix, no escape processing) ───────────────────────────

raw_triple_double_quoted
  = "r" '"""' chars:raw_triple_double_char* '"""' { return chars.join(''); }

raw_triple_double_char
  = !'"""' char:. { return char; }

raw_triple_single_quoted
  = "r" "'''" chars:raw_triple_single_char* "'''" { return chars.join(''); }

raw_triple_single_char
  = !"'''" char:. { return char; }

raw_double_quoted
  = "r" '"' chars:raw_double_char* '"' { return chars.join(''); }

raw_double_char
  = !'"' char:. { return char; }

raw_single_quoted
  = "r" "'" chars:raw_single_char* "'" { return chars.join(''); }

raw_single_char
  = !"'" char:. { return char; }

// ─── Triple double quoted (with escapes) ─────────────────────────────────────

triple_double_quoted
  = '"""' chars:triple_double_char* '"""' { return chars.join(''); }

triple_double_char
  = !'"""' seq:escape_sequence { return seq; }
  / !'"""' !"\\" char:. { return char; }

// ─── Triple single quoted (with escapes) ─────────────────────────────────────

triple_single_quoted
  = "'''" chars:triple_single_char* "'''" { return chars.join(''); }

triple_single_char
  = !"'''" seq:escape_sequence { return seq; }
  / !"'''" !"\\" char:. { return char; }

// ─── Double quoted (with escapes) ────────────────────────────────────────────

double_quoted
  = '"' chars:double_char* '"' { return chars.join(''); }

double_char
  = seq:escape_sequence { return seq; }
  / !'"' !"\\" char:. { return char; }

// ─── Single quoted (with escapes) ────────────────────────────────────────────

single_quoted
  = "'" chars:single_char* "'" { return chars.join(''); }

single_char
  = seq:escape_sequence { return seq; }
  / !"'" !"\\" char:. { return char; }

// ─── Escape sequences (Python-compatible) ────────────────────────────────────

escape_sequence
  = "\\" "n"  { return '\n'; }
  / "\\" "t"  { return '\t'; }
  / "\\" "r"  { return '\r'; }
  / "\\" "0"  { return '\0'; }
  / "\\" "a"  { return '\x07'; }
  / "\\" "b"  { return '\b'; }
  / "\\" "f"  { return '\f'; }
  / "\\" "v"  { return '\v'; }
  / "\\" "\\" { return '\\'; }
  / "\\" "'"  { return "'"; }
  / "\\" '"'  { return '"'; }
  / "\\" other:. { return '\\' + other; }

// ─── Whitespace and comments ─────────────────────────────────────────────────

_ "whitespace"
  = ([ \t\n\r] / comment)*

comment
  = "#" [^\n]* ("\n" / !.)
