/* eslint-disable prefer-exponentiation-operator */
const path = require('path');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader');

module.exports = (env, argv) => ({
  entry: {
    'project-page': './app/views/scripts/src/project-page.js',
    'project-new-page': './app/views/scripts/src/project-new-page.js',
    'project-settings-page':
      './app/views/scripts/src/project-settings-page.js',
    'user-page': './app/views/scripts/src/user-page.js'
  },
  devtool: 'eval-source-map',
  plugins: [
    new CleanWebpackPlugin(['dist']),
    new VueLoaderPlugin()
  ],
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
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      }
    ]
  },
  resolve: {
    symlinks: false
  }
});
