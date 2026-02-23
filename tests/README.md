# Tests

Test configuration for HackMD Search extension.

## Running Tests

```bash
npm install
npm test
```

## Test Structure

- `tests/search.test.js` - Search functionality tests
  - Query splitting
  - Query classification (minus, regex, plus)
  - Pagination calculation

## Adding New Tests

When adding new functionality, create corresponding test files in the `tests/` directory with the `.test.js` suffix.

## Test Update Timing

Tests should be updated when:
- Adding new search features
- Modifying query parsing logic
- Changing pagination behavior
- Adding new configuration options
