// Reading a charge's QR code with the camera, over the pay tab. No board draws
// it: it is laid out as Type charge is, with the camera in a square under the title.

import { useEffect, useRef } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { BackHeader } from '../components/ListScreen';
import { colors, fonts, radius, space } from '../theme/theme';
import { Page, PrimaryButton } from '../components/ui';

/// `onScanned` gets the text of a QR code the camera read and says whether it was a charge; the
/// pay tab closes this screen when it was. The camera reads the same code on every frame it stays
/// in view, so a text refused once is not handed again, nor is anything after a charge was taken:
/// the notice of a refusal goes up once, and a charge is taken once.
export function ScanScreen({ network, onBack, onScanned }) {
  // Null until the system has answered whether the app may use the camera.
  const [permission, requestPermission] = useCameraPermissions();
  const refused = useRef(null);
  const taken = useRef(false);

  // The first time, the system asks as the screen opens; a refusal shows the card below.
  useEffect(() => {
    if (permission?.status === 'undetermined') requestPermission();
  }, [permission, requestPermission]);

  function read({ data }) {
    if (taken.current || data === refused.current) return;
    if (onScanned(data)) taken.current = true;
    else refused.current = data;
  }

  return (
    <Page header={<BackHeader label="Pay" aside={network?.chain.name} onBack={onBack} />}>
      <View style={styles.intro}>
        <Text style={styles.title}>Scan charge</Text>
        <Text style={styles.subtitle}>Point the camera at the charge's QR code.</Text>
      </View>

      <View style={styles.square}>
        {permission?.granted && (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={read}
            />
            <Corner style={{ top: 16, left: 16, borderTopWidth: 3, borderLeftWidth: 3 }} />
            <Corner style={{ top: 16, right: 16, borderTopWidth: 3, borderRightWidth: 3 }} />
            <Corner style={{ bottom: 16, left: 16, borderBottomWidth: 3, borderLeftWidth: 3 }} />
            <Corner style={{ bottom: 16, right: 16, borderBottomWidth: 3, borderRightWidth: 3 }} />
          </>
        )}
        {/* Asked, and refused. While Android still lets the app ask, the button asks again;
            after that only the app's settings can give the camera back. */}
        {permission && !permission.granted && permission.status !== 'undetermined' && (
          <View style={styles.denied}>
            <Text style={styles.deniedText}>
              Nullius needs the camera to read the QR code. Nothing is recorded.
            </Text>
            <PrimaryButton
              label={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
              onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
            />
          </View>
        )}
      </View>
    </Page>
  );
}

/// One corner of the sight over the camera, drawn by the two borders `style` turns on.
function Corner({ style }) {
  return <View style={[styles.corner, style]} />;
}

const styles = StyleSheet.create({
  intro: { marginTop: space.gap, gap: 4 },
  // -0.02em of 24, as Type charge's title.
  title: {
    color: colors.text,
    fontFamily: fonts.ui,
    fontSize: 24,
    fontWeight: '500',
    letterSpacing: -0.48,
  },
  subtitle: { color: colors.text2, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  // As wide as the content and as tall as wide; `overflow` rounds the camera's corners too.
  square: {
    marginTop: space.gap,
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: colors.accent },
  denied: { gap: space.gap, padding: space.cardPad },
  deniedText: {
    color: colors.text2,
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
