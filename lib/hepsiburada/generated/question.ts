/* eslint-disable */
/**
 * Satıcıya Sor Entegrasyonu — generated from openapi/question.json. Do not edit.
 *
 * Source: saticiya-sor-entegrasyonu v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

import type { FileInput } from './fileInput';

export interface ConversationViewModel {
  /** Konuşmanın benzersiz kimliği */
  id?: string;
  /** Konuşmanın tipi */
  type?: string;
  /** Konuşmanın oluşturulma tarihi */
  createdAt?: string;
  /** Mesaj içeriği */
  content?: string;
  /** Mesajı gönderen kişi (Müşteri/Satıcı) */
  from?: string;
  /** Mesaja eklenen dosyaların listesi */
  files?: string[];
  /** Müşteri geri bildirimde bulundu mu? */
  customerFeedback?: boolean;
  /** Reddedilme nedeni (varsa) */
  rejectReason?: string;
  /** Reddedilen conversation (varsa) */
  rejectConversation?: string;
  /** Şema versiyonu */
  schemaVersion?: number;
  /** Son değişiklik tarihi (varsa) */
  lastModifiedAt?: string;
  /** Konuşmada değişiklik yapıldı mı? */
  isConversationModified?: boolean;
  /** Mesaj düzenlenebilir mi? */
  canMessageBeModified?: boolean;
  /** Mesaj okundu mu? */
  isMessageSeen?: boolean;
}

export interface CreateIssueViewModel {
  /** Kaç adet soru oluşturulacağı belirtilir. */
  issueCount?: number;
}

export interface ErrorModel {
  message?: string;
  internalMessage?: string;
}

export interface ErrorModelCustomErrorModel {
  code?: number;
  errors?: ErrorModel[];
}

export interface ErrorModelExtended {
  message?: string;
  internalMessage?: string;
  fieldName?: string;
}

export interface ErrorModelExtendedCustomErrorModel {
  code?: number;
  errors?: ErrorModelExtended[];
}

export interface IssueCountModel {
  /** Yanıt bekleyen soruların sayısı. */
  waitingForAnswer?: number;
  /** Yanıtlanmış soruların sayısı. */
  answered?: number;
  /** Raporlanmış (şikayet edilmiş) soruların sayısı. */
  reported?: number;
  /** Son bir hafta içinde otomatik olarak kapatılan soruların sayısı. */
  autoClosedInLastWeek?: number;
}

/**
 * Soru yanıt bekliyor., Soru yanıtlandı., Soru satıcı tarafından reddedildi., Soru yanıtlanmadığı için otomatik olarak kapatıldı., Satıcı iletişime geçti.
 */
export type IssueEsStatus = number;

export interface IssueViewModel {
  /** Sorunun benzersiz kimliği */
  id?: string;
  /** Sorunun oluşturulma tarihi */
  createdAt?: string;
  /** Sorunun numarası */
  issueNumber?: number;
  /** Soruyu soran müşteri kimliği */
  customerId?: string;
  /** Sipariş numarası */
  orderNumber?: string;
  /** Sipariş satır numarası */
  lineItemId?: string;
  /**
   * Sorunun durumu. Durumlar şunlardır:  1. 'WaitingForAnswer' - Soru yanıt bekliyor.  2. 'Answered' - Soru yanıtlandı.  3. 'Rejected' - Soru, satıcı tarafından şikayet edildi.  4. 'AutoClosed' - Soru otomatik olarak kapatıldı.
   */
  status?: string;
  subject?: SubjectViewModel;
  /** Sorunun son mesaj içeriği */
  lastContent?: string;
  /** Soruyla ilgili konuşmaların listesi */
  conversations?: ConversationViewModel[];
  merchant?: MerchantViewModel;
  product?: ProductViewModel;
  /** Sorunun cevaplanması için kalan süre */
  expireDate?: string;
  /** Son değişiklik tarihi */
  lastModifiedAt?: string;
  /** Müşteri mesajı gördü mü? */
  didCustomerSeeTheMessage?: boolean;
  /** Şema versiyonu */
  schemaVersion?: number;
}

export interface IssueViewModelPaginatedResultViewModel {
  data?: IssueViewModel[];
  currentPage?: number;
  currentPageSize?: number;
  totalPageCount?: number;
  totalItemCount?: number;
  nextPage?: number;
  previousPage?: number;
}

export interface MerchantViewModel {
  /** Satıcının benzersiz kimliği */
  id?: string;
  /** Satıcının adı */
  name?: string;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
}

export interface ProductViewModel {
  /** Ürünün SKU (Stok Tutma Birimi) kodu */
  sku?: string;
  /** Ürünün adı */
  name?: string;
  /** Ürünün görsel URL'si */
  imageUrl?: string;
  /** Ürünün stok kodu */
  stockCode?: string;
}

export interface RejectIssueViewModel {
  /** Şikayetin neden reddedildiğine dair açıklama, en fazla 2000 karakter olabilir. */
  rejectReason?: string;
  /** Şikayet belirli bir konuşma ile reddediliyorsa, ilgili konuşmanın ID'si. */
  rejectConversationId?: string;
}

/** , */
export type SortBy = number;

export interface SubjectViewModel {
  /** Konunun benzersiz kimliği */
  id?: string;
  /** Konunun açıklaması */
  description?: string;
}

/**
 * Soru Listesi
 *
 * `GET /api/v1.0/issues`
 * Published as "Soru Listesi".
 */
export interface GetIssuesQuery {
  /** Soru kaynağı (Opsiyonel) 1:Siparişle ilgili değil, 2:Siparişle ilgili. Boş ise hepsi */
  source?: number;
  /** Sorunun konusu (Opsiyonel) */
  subject?: string;
  /** Minimum oluşturulma tarihi (Opsiyonel) */
  minCreatedAt?: string;
  /** Maksimum oluşturulma tarihi (Opsiyonel) */
  maxCreatedAt?: string;
  /** Minimum değiştirilme tarihi (Opsiyonel) */
  minModifiedAt?: string;
  /** Maksimum değiştirilme tarihi (Opsiyonel) */
  maxModifiedAt?: string;
  /** Sorunun numarası (Opsiyonel) */
  issueNumber?: number;
  /**
   * Sorunun durumları (Opsiyonel). Durumlar şunlardır:  1. 'WaitingForAnswer' - Soru yanıt bekliyor.  2. 'Answered' - Soru yanıtlandı.  3. 'Rejected' - Soru, satıcı tarafından şikayet edildi.  4. 'AutoClosed' - Soru otomatik olarak kapatıldı.
   */
  status?: IssueEsStatus[];
  /** Arama metni (Opsiyonel) */
  search?: string;
  /** Sıralama tipi (Varsayılan: CreatedAt) */
  sortBy?: SortBy;
  /** Azalan sıralama mı? (Varsayılan: true) */
  desc?: boolean;
  /** Sayfa numarası (Varsayılan: 1) */
  page?: number;
  /** Sayfa başına eleman sayısı (Varsayılan: 25) */
  size?: number;
}

export type GetIssuesResponse = IssueViewModelPaginatedResultViewModel;

/**
 * Soru Oluşturma
 *
 * `POST /api/v1.0/issues`
 * Published as "Soru Oluşturma".
 */
export type PostIssuesBody = CreateIssueViewModel;

export type PostIssuesResponse = number[];

/**
 * Soru Detayının Çekilmesi
 *
 * `GET /api/v1.0/issues/{number}`
 * Published as "Soru Detayının Çekilmesi".
 */
export interface GetIssuesByNumberParams {
  /** Sorunun numarası */
  number: number;
}

export type GetIssuesByNumberResponse = IssueViewModel;

/**
 * Soru Cevaplama
 *
 * `POST /api/v1.0/issues/{number}/answer`
 * Published as "Soru Cevaplama".
 */
export interface PostIssuesAnswerParams {
  /** Sorunun numarası */
  number: number;
}

export interface PostIssuesAnswerBody {
  /** Yanıtla birlikte gönderilecek dosyalar koleksiyonu. */
  Files?: FileInput[];
  /** Yanıt içeriği, en fazla 2000 karakter olabilir. */
  Answer?: string;
}

export type PostIssuesAnswerResponse = string;

/**
 * Sorun Bildirme
 *
 * `POST /api/v1.0/issues/{number}/reject`
 * Published as "Sorun Bildirme".
 */
export interface PostIssuesRejectParams {
  /** Sorunun numarası */
  number: number;
}

export type PostIssuesRejectBody = RejectIssueViewModel;

export type PostIssuesRejectResponse = string;

/**
 * Statü Bazlı Soru Sayısı
 *
 * `GET /api/v1.0/issues/count`
 * Published as "Statü Bazlı Soru Sayısı".
 */
export type GetIssuesCountResponse = IssueCountModel;
