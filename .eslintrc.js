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
      files: [
        'app/views/scripts/components/Tools.vue',
        'app/views/scripts/components/Embed.vue',
        'app/views/scripts/components/Data.vue',
        'app/views/scripts/components/LayersManager.vue'
      ],
      rules: {
        'max-lines': 'off',
        'no-undef': 'off'
      }
    }
  ]
};
