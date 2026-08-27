import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type ImageSlot =
  | { id: string; status: 'uploading'; localUri: string }
  | { id: string; status: 'done';      localUri: string; url: string }
  | { id: string; status: 'error';     localUri: string; error: string };

export type UploadFn = (fileOrUri: Blob | string) => Promise<{ url: string }>;

let _uid = 0;
const nextId = () => String(++_uid);

function compressForUpload(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', 0.7);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function useImageSlots(initialUrls: string[] = []) {
  const [slots, setSlots] = useState<ImageSlot[]>(() =>
    initialUrls.map(url => ({ id: nextId(), status: 'done' as const, localUri: url, url }))
  );

  const _run = (id: string, localUri: string, fn: UploadFn, fileOrUri: Blob | string) => {
    fn(fileOrUri)
      .then(({ url }) =>
        setSlots(prev => prev.map(s => s.id === id ? { id, status: 'done', localUri, url } : s))
      )
      .catch((e: unknown) => {
        const error = e instanceof Error ? e.message : 'Upload failed';
        setSlots(prev => prev.map(s => s.id === id ? { id, status: 'error', localUri, error } : s));
      });
  };

  const pick = async (fn: UploadFn, onPermissionError: (msg: string) => void) => {
    if (Platform.OS === 'web') {
      await new Promise<void>(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/webp';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { resolve(); return; }
          const localUri = URL.createObjectURL(file);
          const id = nextId();
          setSlots(prev => [...prev, { id, status: 'uploading', localUri }]);
          compressForUpload(file)
            .then(blob => _run(id, localUri, fn, blob))
            .catch((e: unknown) => {
              const error = e instanceof Error ? e.message : 'Compression failed';
              setSlots(prev => prev.map(s => s.id === id ? { id, status: 'error', localUri, error } : s));
            });
          resolve();
        };
        input.click();
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { onPermissionError('Photo library access is required.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.6 });
      if (result.canceled) return;
      const localUri = result.assets[0].uri;
      const id = nextId();
      // Add slot immediately — upload runs in background so user can keep filling the form
      setSlots(prev => [...prev, { id, status: 'uploading', localUri }]);
      _run(id, localUri, fn, localUri);
    }
  };

  const retrySlot = (slotId: string, fn: UploadFn) => {
    const slot = slots.find(s => s.id === slotId);
    if (!slot || slot.status !== 'error') return;
    setSlots(prev => prev.map(s => s.id === slotId ? { id: slotId, status: 'uploading', localUri: slot.localUri } : s));
    _run(slotId, slot.localUri, fn, slot.localUri);
  };

  const doneUrls = slots
    .filter((s): s is Extract<ImageSlot, { status: 'done' }> => s.status === 'done')
    .map(s => s.url);

  const isUploading = slots.some(s => s.status === 'uploading');

  return { slots, pick, retrySlot, doneUrls, isUploading };
}
