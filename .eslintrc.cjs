module.exports = {
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{ name: '../config/env.js', importNames: ['ENV'], message: 'Use getEnv({loose:true}) at runtime.' }],
    }],
    'no-restricted-syntax': ['error', {
      selector: "Program > VariableDeclaration > VariableDeclarator > MemberExpression[object.name='process'][property.name='env']",
      message: 'No process.env at module scope — read via getEnv() inside functions.',
    }],
  },
};
