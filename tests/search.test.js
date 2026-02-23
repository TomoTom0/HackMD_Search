/**
 * Search functionality tests
 */

// searchQuerySplit関数のテスト用モック
function searchQuerySplit(query) {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < query.length) {
        const char = query[i];

        if (char === '"' && !inQuotes) {
            inQuotes = true;
            i++;
            continue;
        }

        if (char === '"' && inQuotes) {
            inQuotes = false;
            if (current) {
                result.push(current);
                current = '';
            }
            i++;
            continue;
        }

        if (char === ' ' && !inQuotes) {
            if (current) {
                result.push(current);
                current = '';
            }
            i++;
            continue;
        }

        current += char;
        i++;
    }

    if (current) {
        result.push(current);
    }

    return result;
}

describe('searchQuerySplit', () => {
    test('splits simple words by space', () => {
        expect(searchQuerySplit('word1 word2')).toEqual(['word1', 'word2']);
    });

    test('handles single word', () => {
        expect(searchQuerySplit('word')).toEqual(['word']);
    });

    test('handles empty string', () => {
        expect(searchQuerySplit('')).toEqual([]);
    });

    test('handles multiple spaces', () => {
        expect(searchQuerySplit('word1   word2')).toEqual(['word1', 'word2']);
    });

    test('handles quoted phrases', () => {
        expect(searchQuerySplit('"phrase with spaces"')).toEqual(['phrase with spaces']);
    });

    test('handles mixed quoted and unquoted', () => {
        expect(searchQuerySplit('word1 "phrase with spaces" word2')).toEqual(['word1', 'phrase with spaces', 'word2']);
    });

    test('handles minus prefix', () => {
        expect(searchQuerySplit('word1 -word2')).toEqual(['word1', '-word2']);
    });

    test('handles reg: prefix', () => {
        expect(searchQuerySplit('word1 reg:pattern')).toEqual(['word1', 'reg:pattern']);
    });
});

describe('Search query classification', () => {
    function classifyQueries(queries) {
        return {
            minus: queries.filter(d => /^-/.test(d)).map(d => d.slice(1)),
            reg: queries.filter(d => /^reg:/.test(d)).map(d => d.slice(4)),
            plus: queries.filter(d => !/^-|^reg:/.test(d))
        };
    }

    test('classifies minus queries', () => {
        const result = classifyQueries(['word', '-exclude']);
        expect(result.minus).toEqual(['exclude']);
        expect(result.plus).toEqual(['word']);
    });

    test('classifies regex queries', () => {
        const result = classifyQueries(['word', 'reg:pattern']);
        expect(result.reg).toEqual(['pattern']);
        expect(result.plus).toEqual(['word']);
    });

    test('classifies mixed queries', () => {
        const result = classifyQueries(['word1', '-exclude', 'reg:pattern', 'word2']);
        expect(result.minus).toEqual(['exclude']);
        expect(result.reg).toEqual(['pattern']);
        expect(result.plus).toEqual(['word1', 'word2']);
    });
});

describe('Pagination', () => {
    function calculatePagination(totalItems, pageSize, currentPage) {
        const totalPages = Math.ceil(totalItems / pageSize);
        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, totalItems);
        return {
            totalPages,
            startIdx,
            endIdx,
            hasNext: currentPage < totalPages,
            hasPrev: currentPage > 1
        };
    }

    test('calculates pagination for first page', () => {
        const result = calculatePagination(100, 50, 1);
        expect(result.totalPages).toBe(2);
        expect(result.startIdx).toBe(0);
        expect(result.endIdx).toBe(50);
        expect(result.hasNext).toBe(true);
        expect(result.hasPrev).toBe(false);
    });

    test('calculates pagination for last page', () => {
        const result = calculatePagination(100, 50, 2);
        expect(result.totalPages).toBe(2);
        expect(result.startIdx).toBe(50);
        expect(result.endIdx).toBe(100);
        expect(result.hasNext).toBe(false);
        expect(result.hasPrev).toBe(true);
    });

    test('calculates pagination for partial last page', () => {
        const result = calculatePagination(75, 50, 2);
        expect(result.totalPages).toBe(2);
        expect(result.startIdx).toBe(50);
        expect(result.endIdx).toBe(75);
    });

    test('calculates pagination for empty results', () => {
        const result = calculatePagination(0, 50, 1);
        expect(result.totalPages).toBe(0);
        expect(result.startIdx).toBe(0);
        expect(result.endIdx).toBe(0);
    });

    test('calculates pagination with different page sizes', () => {
        expect(calculatePagination(100, 20, 1).totalPages).toBe(5);
        expect(calculatePagination(100, 100, 1).totalPages).toBe(1);
        expect(calculatePagination(100, 200, 1).totalPages).toBe(1);
    });
});
