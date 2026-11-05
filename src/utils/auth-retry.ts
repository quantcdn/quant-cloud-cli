import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

/** Called with the token a request sent. Returns a new token, or null. */
export type Renew = (sentToken: string) => Promise<string | null>;

type RetryConfig = InternalAxiosRequestConfig & { _qcRenewed?: boolean };

function sentToken(config: RetryConfig): string {
  return String(config.headers?.Authorization ?? '').replace(/^Bearer\s+/i, '');
}

async function retryAfterRenewal(http: AxiosInstance, renew: Renew, error: AxiosError): Promise<unknown> {
  const config = error?.config as RetryConfig | undefined;
  if (error?.response?.status !== 401 || !config || config._qcRenewed) {
    throw error;
  }
  config._qcRenewed = true;
  const token = await renew(sentToken(config));
  if (!token) {
    throw error;
  }
  config.headers.set('Authorization', `Bearer ${token}`);
  return http.request(config);
}

/**
 * An axios instance for the quant-client APIs. After a 401 it renews the token
 * once and sends the same request again. A second 401 goes to the caller.
 */
export function createRenewingAxios(renew: Renew): AxiosInstance {
  const http = axios.create();
  http.interceptors.response.use(undefined, (error) => retryAfterRenewal(http, renew, error));
  return http;
}
