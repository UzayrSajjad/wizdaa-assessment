module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/'],
    testRegex: '.*\\.e2e-spec\\.js$',
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
    moduleFileExtensions: ['js', 'json'],
};
