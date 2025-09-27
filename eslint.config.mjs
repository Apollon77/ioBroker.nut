import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['**/*{.,-}min.js'],
    },
    {
        files: ['test/**/*.js'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                before: 'readonly',
                after: 'readonly',
                oNut: 'readonly',
                self: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-undef': 'off', // Allow test globals
            '@typescript-eslint/no-this-alias': 'off', // Allow 'self' alias in tests
            'no-global-assign': 'off', // Allow test globals to be assigned
            'no-empty': 'off', // Allow empty catch blocks in tests
            'no-constant-binary-expression': 'off', // Allow test conditions
            'valid-typeof': 'off', // Allow test typeof checks
        },
    },
];
