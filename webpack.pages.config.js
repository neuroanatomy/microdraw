/* eslint-disable prefer-exponentiation-operator */
const path = require('path');
const CleanWebpackPlugin = require('clean-webpack-plugin');

module.exports = (env, argv) => ({
  entry: {
    'admin-page': './app/views/scripts/src/admin-page.js',
    'project-new-page': './app/views/scripts/src/project-new-page.js',
    'project-page': './app/views/scripts/src/project-page.js',
    'project-settings-page':
      './app/views/scripts/src/project-settings-page.js',
    'user-page': './app/views/scripts/src/user-page.js'
  },
  // N3: no source map in production (eval-source-map tripled the pages' size);
  // `npm run dev-pages` keeps it for debugging
  devtool: argv.mode === 'production' ? false : 'eval-source-map',
  plugins: [new CleanWebpackPlugin(['dist'])],
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'app/views/scripts/dist')
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        use: ['file-loader']
      }
    ]
  },
  resolve: {
    symlinks: false,
    alias: {
      // for now using the browser build to parse existing inlined components
      vue: path.resolve(
        `./node_modules/vue/dist/vue.esm-browser${
          argv.mode === 'production' ? '.prod' : ''
        }`
      )
    }
  }
});
