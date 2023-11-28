module.exports = {
  'env': {
    'mocha': true
  },
  'extends': [
    'naat',
    'plugin:vue/vue3-strongly-recommended'
  ],
  'rules': { 'vue/multi-word-component-names': 'off' },
  'overrides': [
    {
      files: ['app/views/scripts/components/Tools.vue'],
      rules: {
        'max-lines': 'off',
        'no-undef': 'off'
      }
    }
  ]
};
