/**
 * Docmem definitions for Three Stooges
 * Encoded from three-stooges.toml
 */

const STOOGES_DOCMEM_ID = 'three-stooges';

// Node data structure
// Format: [id, parentId, contextType, contextName, contextValue, content, order]
const STOOGES_DATA = [
    [STOOGES_DOCMEM_ID, null, 'root', 'purpose', 'document', '', 0.0],
    ['dbmbzbn6', STOOGES_DOCMEM_ID, 'stooge', 'name', 'moe', 'Moe Howard was the leader of the group, known for his bowl haircut and tendency to slap and hit the other stooges.', 1.0],
    ['gud6bixg', 'dbmbzbn6', 'funfact', 'fact', 'one', 'Moe\'s real name was Moses Harry Horwitz.', 1.0],
    ['7mg7dzy5', 'dbmbzbn6', 'funfact', 'fact', 'two', 'He was the only stooge to appear in all 190 shorts.', 2.0],
    ['mkgwrc4y', 'dbmbzbn6', 'funfact', 'fact', 'three', 'Moe invented the \'Moe-hawk\' hairstyle as part of his character.', 3.0],
    ['2t6wxas5', STOOGES_DOCMEM_ID, 'stooge', 'name', 'larry', 'Larry Fine was known for his wild red hair and high-pitched voice. He played the violin and was often the target of the other stooges\' pranks.', 2.0],
    ['4r2rvmsu', '2t6wxas5', 'funfact', 'fact', 'one', 'Larry\'s real name was Louis Feinberg.', 1.0],
    ['si44ipxa', '2t6wxas5', 'funfact', 'fact', 'two', 'He was an accomplished violinist and often played music on set.', 2.0],
    ['6uz6rgae', '2t6wxas5', 'funfact', 'fact', 'three', 'Larry had naturally curly hair, not straight like Moe or bald like Curly.', 3.0],
    ['u2a5ppm2', STOOGES_DOCMEM_ID, 'stooge', 'name', 'curly', 'Curly Howard was known for his bald head, distinctive laugh, and physical comedy. He was famous for his \'nyuk nyuk\' sound and eye-poking antics.', 3.0],
    ['x2gb97m8', 'u2a5ppm2', 'funfact', 'fact', 'one', 'Curly\'s real name was Jerome Lester Horwitz, Moe\'s younger brother.', 1.0],
    ['z3nburr3', 'u2a5ppm2', 'funfact', 'fact', 'two', 'He shaved his head for the role and it became his signature look.', 2.0],
    ['8cehjgkh', 'u2a5ppm2', 'funfact', 'fact', 'three', 'Curly was an excellent dancer and often incorporated dance moves into comedy routines.', 3.0],
];

// Export constants to window for seed.js
window.STOOGES_DOCMEM_ID = STOOGES_DOCMEM_ID;
window.STOOGES_DATA = STOOGES_DATA;
