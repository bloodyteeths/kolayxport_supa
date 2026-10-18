/** A file to upload (multipart). Shape matches the vendored generated types (see ./LICENSE). */
export type FileInput =
  | Blob
  | {
      data: Blob | ArrayBuffer | ArrayBufferView | string;
      filename: string;
      contentType?: string;
    };
