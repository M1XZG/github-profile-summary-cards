import * as core from '@actions/core';
import rax from 'retry-axios';
import axios from 'axios';

rax.attach();

// GitHub returns a 403 (not a 5xx) when a caller trips a *secondary* rate limit.
// Chunking large accounts into monthly windows multiplies request volume, so we
// must recognise and back off on these instead of failing the card.
const isSecondaryRateLimit = (err: any): boolean => {
    if (err?.response?.status !== 403) {
        return false;
    }
    const message: string = err?.response?.data?.message || '';
    return /secondary rate limit/i.test(message);
};

// Chunking a large account produces long bursts of sequential GraphQL calls.
// GitHub trips a *secondary* rate limit when requests arrive too fast, so we
// serialise every request through a promise chain and space them out. This is
// far cheaper than repeatedly hitting the limit and backing off.
const MIN_REQUEST_GAP_MS = Number(process.env.PSC_REQUEST_GAP_MS ?? 700);
let requestGate: Promise<void> = Promise.resolve();
function pace(): Promise<void> {
    const next = requestGate.then(() => new Promise<void>(resolve => setTimeout(resolve, MIN_REQUEST_GAP_MS)));
    requestGate = next;
    return next;
}

export default async function request(header: any, data: any): Promise<any> {
    await pace();
    return axios({
        url: 'https://api.github.com/graphql',
        method: 'post',
        headers: header,
        data: data,
        timeout: 25000, // avoid hanging requests; heavy monthly queries can be slow
        raxConfig: {
            retry: 6,
            noResponseRetries: 3,
            retryDelay: 2000,
            backoffType: 'exponential',
            httpMethodsToRetry: ['POST'],
            // Retry on 5xx, 429, and informational/transient ranges
            statusCodesToRetry: [
                [100, 199],
                [429, 429],
                [500, 599]
            ],
            checkRetryAfter: true,
            maxRetryAfter: 300000,
            // Custom predicate so we also retry secondary-rate-limit 403s while
            // still failing fast on genuine auth/permission 403s.
            shouldRetry: (err: any) => {
                const cfg = rax.getConfig(err);
                const attempt = cfg?.currentRetryAttempt ?? 0;
                const max = cfg?.retry ?? 6;
                if (attempt >= max) {
                    return false;
                }
                if (!err.response) {
                    return true; // network error / timeout
                }
                const status = err.response.status;
                if (status === 429 || (status >= 500 && status <= 599)) {
                    return true;
                }
                return isSecondaryRateLimit(err);
            },
            onRetryAttempt: (err: any) => {
                const cfg = rax.getConfig(err);
                // Avoid logging sensitive headers/tokens
                core.warning(
                    `GitHub API request failed: ${err?.response?.status || ''} ${err?.message || ''}${
                        isSecondaryRateLimit(err) ? ' (secondary rate limit)' : ''
                    }. Retry #${cfg?.currentRetryAttempt || 0}`
                );
            }
        }
    });
}
