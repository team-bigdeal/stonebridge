// 웹 검색으로 고른 업체 목록 (실행 중 레지스트리)
import type { VendorId, VendorInfo } from '@shared/types';
import { scoped } from './session';

const vendors = scoped(() => new Map<VendorId, VendorInfo>());

export const setVendors = (list: VendorInfo[]) => {
  vendors.clear();
  for (const v of list) vendors.set(v.id, v);
};
export const getVendor = (id: VendorId) => vendors.get(id);
export const listVendors = () => [...vendors.values()];
export const vendorName = (id: VendorId) => vendors.get(id)?.name ?? `${id}업체`;
export const vendorLabel = (id: VendorId) => `${id} · ${vendorName(id)}`;
export function replaceVendor(v: VendorInfo) {
  vendors.set(v.id, v);
}

export function setVendorEmail(id: VendorId, email: string) {
  const v = vendors.get(id);
  if (v && email) v.email = email;
}
