function randomString(length) {
    if (length <= 0) {
        throw new Error('Length must be greater than 0');
    }
    
    // Alphabet: 0-9, a-z excluding 0, 1, o, l (32 characters)
    const alphabet = '23456789abcdefghijkmnpqrstuvwxyz';
    
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * alphabet.length);
        result += alphabet[randomIndex];
    }
    
    return result;
}

