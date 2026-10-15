// test/listingEditor/c-messages.ts — M6 editor Group C strings (`listingEditor.*` used by PhotosSection, PhotoPanel and
// the embedded ImageManager / VideoUploader), returned to the integrator as newI18nKeys. Keys that listing-editor §8
// already lists keep its exact text. The render tests layer them over messages/{en,tr}.json.
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';
import { m6sKeys } from '../ds/m6s-harness';

export type Locale = 'en' | 'tr';
type Tree = { [k: string]: string | Tree };

export const cKeys: Record<Locale, Tree> = {
  en: {
    section: { photos: 'Photos & video', photosEbay: 'Photos' },
    photos: {
      needAlt: '{count, plural, one {# needs alt text} other {# need alt text}}',
      dropzone: 'Drop photos here or',
      choose: 'Choose photos',
      hint: 'JPG, PNG or GIF, up to {max} · 2000px or larger looks best',
      hintEbay: 'JPG, PNG or GIF, up to {max} · 1600px or larger looks best',
      pasteLinks: 'Paste image links',
      makePrimary: 'Make primary',
      replace: 'Replace',
      remove: 'Remove',
      altLabel: 'Alt text',
      altHelper: 'Describes the photo for screen readers and search',
      noPhotos: 'This listing has no photos. {marketplace} needs at least 1 to publish',
      panelTitle: 'Photo {position} of {total}',
      photoN: 'Photo {position}',
      close: 'Close',
      saveAlt: 'Save alt text',
      saveAltDisabled: 'Change the alt text first',
      writeAltOne: 'Write alt text',
      altAfterSend: 'You can add alt text once this photo is on {marketplace}',
      pendingNote: 'New photo: it is added when you send changes',
      willRemoveOnSend: 'Will be removed from {marketplace} when you send changes',
      altBatchTitle: 'Write alt text',
      altBatchIntro: '{count, plural, one {# photo} other {# photos}} without alt text. Nothing changes on {marketplace} until you send',
      altBatchWaiting: 'Wait for a suggestion first',
      altBatchNone: 'Every photo has alt text',
      altBatchDone: 'All suggestions handled',
      saving: 'Saving photo changes…',
      stageFailed: "Couldn't save the photo change",
      badType: "{count, plural, one {# file isn't} other {# files aren't}} a JPG, PNG, GIF or WebP image",
      overLimit: "{max} photos is {marketplace}'s limit. {count, plural, one {# photo wasn't} other {# photos weren't}} added",
      pendingReorder: 'New photos keep their place until they are on {marketplace}',
      pendingRemoveViaDiscard: 'This new photo is only in your draft. Discard changes to remove it',
      confirmRemoveTitle: 'Remove photo {position}?',
      confirmRemoveBody: 'It is removed from {marketplace} when you send changes',
      linksLabel: 'Image links',
      linksHelper: 'One https link per line. {marketplace} gets the photos when you send changes',
      linksAdd: 'Add photos',
      linksEmpty: 'Paste at least one link',
      linksRejected: '{count, plural, one {# link was} other {# links were}} skipped (not https, repeated or over the limit)',
      fullUntilSent: '{marketplace} allows {max} photos. Removed photos count until you send, so send changes first, then add more',
      aiPhotoAdded: 'Photo added. It goes to {marketplace} when you send changes',
    },
    video: {
      label: 'Video',
      add: 'Add video',
      loadFailed: "Couldn't load the video",
      noPreview: 'Preview available after you send changes',
      processing: '{marketplace} is still processing this video',
      unsupported: 'Use an MP4, WebM or MOV file',
      tooLarge: 'Videos can be up to 100 MB',
      pendingRemoveViaDiscard: 'This new video is only in your draft. Discard changes to remove it',
      confirmRemoveTitle: 'Remove the video?',
    },
    ai: {
      writeAlt: 'Write alt text for {count}',
      generatePhoto: 'Generate a photo',
      writing: 'Writing…',
      useAll: 'Use all',
      replaced: '{field} replaced',
    },
    banner: { undo: 'Undo' },
  },
  tr: {
    section: { photos: 'Fotoğraflar ve video', photosEbay: 'Fotoğraflar' },
    photos: {
      needAlt: '{count} fotoğrafta alt metin yok',
      dropzone: 'Fotoğrafları buraya bırakın veya',
      choose: 'Fotoğraf seçin',
      hint: 'JPG, PNG veya GIF, en fazla {max} · 2000px ve üzeri en iyi sonucu verir',
      hintEbay: 'JPG, PNG veya GIF, en fazla {max} · 1600px ve üzeri en iyi sonucu verir',
      pasteLinks: 'Görsel bağlantısı yapıştır',
      makePrimary: 'Ana fotoğraf yap',
      replace: 'Değiştir',
      remove: 'Kaldır',
      altLabel: 'Alt metin',
      altHelper: 'Fotoğrafı ekran okuyucular ve arama için tanımlar',
      noPhotos: 'Bu ilanda fotoğraf yok. {marketplace} yayın için en az 1 fotoğraf ister',
      panelTitle: 'Fotoğraf {position} / {total}',
      photoN: 'Fotoğraf {position}',
      close: 'Kapat',
      saveAlt: 'Alt metni kaydet',
      saveAltDisabled: 'Önce alt metni değiştirin',
      writeAltOne: 'Alt metin yaz',
      altAfterSend: 'Bu fotoğraf {marketplace}\'de olunca alt metin ekleyebilirsiniz',
      pendingNote: 'Yeni fotoğraf: değişiklikleri gönderdiğinizde eklenir',
      willRemoveOnSend: 'Değişiklikleri gönderdiğinizde {marketplace}\'den kaldırılır',
      altBatchTitle: 'Alt metin yaz',
      altBatchIntro: 'Alt metni olmayan {count} fotoğraf. Siz gönderene kadar {marketplace}\'de hiçbir şey değişmez',
      altBatchWaiting: 'Önce bir öneri bekleyin',
      altBatchNone: 'Her fotoğrafın alt metni var',
      altBatchDone: 'Tüm öneriler işlendi',
      saving: 'Fotoğraf değişiklikleri kaydediliyor…',
      stageFailed: 'Fotoğraf değişikliği kaydedilemedi',
      badType: '{count} dosya JPG, PNG, GIF veya WebP görseli değil',
      overLimit: '{marketplace} en fazla {max} fotoğrafa izin verir. {count} fotoğraf eklenmedi',
      pendingReorder: 'Yeni fotoğraflar {marketplace}\'de olana kadar yerinde kalır',
      pendingRemoveViaDiscard: 'Bu yeni fotoğraf yalnızca taslağınızda. Kaldırmak için değişiklikleri atın',
      confirmRemoveTitle: '{position}. fotoğraf kaldırılsın mı?',
      confirmRemoveBody: 'Değişiklikleri gönderdiğinizde {marketplace}\'den kaldırılır',
      linksLabel: 'Görsel bağlantıları',
      linksHelper: 'Her satıra bir https bağlantısı. Fotoğraflar değişiklikleri gönderdiğinizde eklenir',
      linksAdd: 'Fotoğrafları ekle',
      linksEmpty: 'En az bir bağlantı yapıştırın',
      linksRejected: '{count} bağlantı atlandı (https değil, tekrar ediyor veya sınırı aşıyor)',
      fullUntilSent: '{marketplace} en fazla {max} fotoğrafa izin verir. Kaldırdığınız fotoğraflar siz gönderene kadar sayılır; önce değişiklikleri gönderin, sonra yenilerini ekleyin',
      aiPhotoAdded: 'Fotoğraf eklendi. Değişiklikleri gönderdiğinizde {marketplace} ilanına eklenir',
    },
    video: {
      label: 'Video',
      add: 'Video ekle',
      loadFailed: 'Video yüklenemedi',
      noPreview: 'Önizleme değişiklikleri gönderdikten sonra görünür',
      processing: '{marketplace} bu videoyu hâlâ işliyor',
      unsupported: 'MP4, WebM veya MOV dosyası kullanın',
      tooLarge: 'Videolar en fazla 100 MB olabilir',
      pendingRemoveViaDiscard: 'Bu yeni video yalnızca taslağınızda. Kaldırmak için değişiklikleri atın',
      confirmRemoveTitle: 'Video kaldırılsın mı?',
    },
    ai: {
      writeAlt: '{count} fotoğraf için alt metin yaz',
      generatePhoto: 'Fotoğraf oluştur',
      writing: 'Yazılıyor…',
      useAll: 'Hepsini kullan',
      replaced: '{field} değiştirildi',
    },
    banner: { undo: 'Geri al' },
  },
};

/** Flat `{ namespace, key, en, tr }` rows (the StructuredOutput `newI18nKeys` shape). */
export function flatKeys(): Array<{ namespace: string; key: string; en: string; tr: string }> {
  const rows: Array<{ namespace: string; key: string; en: string; tr: string }> = [];
  const walk = (enT: Tree, trT: Tree, path: string[]) => {
    for (const [k, v] of Object.entries(enT)) {
      if (typeof v === 'string') rows.push({ namespace: 'listingEditor', key: [...path, k].join('.'), en: v, tr: String((trT as Tree)[k]) });
      else walk(v, (trT[k] as Tree) ?? {}, [...path, k]);
    }
  };
  walk(cKeys.en, cKeys.tr, []);
  return rows;
}

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = typeof v === 'string' ? v : merge((base[k] as Tree) ?? {}, v);
  return out;
}

export function cMessages(locale: Locale): Tree {
  const base = (locale === 'en' ? en : tr) as unknown as Tree;
  const s = m6sKeys[locale];
  return merge(base, {
    ds: { page: { sectionNav: s.sectionNav }, inputs: { images: s.images } },
    listingEditor: cKeys[locale],
  });
}
