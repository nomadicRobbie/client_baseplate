const required = (key) => {
  const v = process.env[key]
  if (!v) throw new Error(`app.config.js: missing required env var ${key}`)
  return v
}

module.exports = {
  expo: {
    name: required('EXPO_PUBLIC_APP_NAME'),
    slug: required('EXPO_PUBLIC_APP_SLUG'),
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: required('EXPO_PUBLIC_APP_SCHEME'),
    userInterfaceStyle: 'automatic',

    ios: {
      icon: './assets/images/icon.png',
      bundleIdentifier: required('EXPO_PUBLIC_BUNDLE_ID'),
      associatedDomains: [`webcredentials:${required('EXPO_PUBLIC_APP_DOMAIN')}`],
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },

    android: {
      adaptiveIcon: {
        backgroundColor: process.env.EXPO_PUBLIC_SPLASH_COLOR ?? '#f5f0e8',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      package: required('EXPO_PUBLIC_BUNDLE_ID'),
    },

    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },

    plugins: [
      'expo-router',
      'expo-notifications',
      [
        'expo-splash-screen',
        {
          backgroundColor: process.env.EXPO_PUBLIC_SPLASH_COLOR ?? '#f5f0e8',
          android: { image: './assets/images/splash-icon.png', imageWidth: 160 },
        },
      ],
      'expo-sqlite',
      '@react-native-community/datetimepicker',
    ],

    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },

    extra: {
      router: {},
      eas: { projectId: required('EXPO_PUBLIC_EAS_PROJECT_ID') },
    },

    owner: process.env.EXPO_PUBLIC_EXPO_OWNER ?? 'exponomads',

    runtimeVersion: { policy: 'appVersion' },

    updates: {
      url: `https://u.expo.dev/${required('EXPO_PUBLIC_EAS_PROJECT_ID')}`,
    },
  },
}
