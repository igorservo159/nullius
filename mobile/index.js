// First import, before anything that may call it: Hermes has no `crypto.getRandomValues`, and
// this defines it over Android's secure generator. `randomSalt` and viem's key generation use it.
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';

import App from './src/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
