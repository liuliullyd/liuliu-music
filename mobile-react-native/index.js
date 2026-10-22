/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { installReleaseDiagnostics } from './src/services/releaseDiagnostics';
import { runCarLibraryTask } from './src/services/carLibraryTasks';

installReleaseDiagnostics();
AppRegistry.registerHeadlessTask('LiuliuCarLibrary', () => runCarLibraryTask);
AppRegistry.registerComponent(appName, () => App);
