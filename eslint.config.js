import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.browser  // For frontend files
      },
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // Guardrail rules (strict)
      'no-restricted-imports': ['error', {
        paths: [{ 
          name: '../config/env.js', 
          importNames: ['ENV'], 
          message: 'Use getEnv({loose:true}) at runtime.' 
        }],
      }],
      'no-restricted-syntax': ['error', {
        selector: "Program > VariableDeclaration > VariableDeclarator > MemberExpression[object.name='process'][property.name='env']",
        message: 'No process.env at module scope — read via getEnv() inside functions.',
      }],
      
      // Relax other rules for development
      'no-unused-vars': 'warn',
      'no-undef': 'warn',
      'no-unreachable': 'warn',
      'no-prototype-builtins': 'warn'
    },
  },
];
