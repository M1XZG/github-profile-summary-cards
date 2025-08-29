import core from '@actions/core';
import rax from 'retry-axios';
import axios, {AxiosPromise} from 'axios';

rax.attach();

export default function request(header: any, data: any): AxiosPromise<any> {
    return axios({
        url: 'https://api.github.com/graphql',
        method: 'post',
        headers: header,
        data: data,
        timeout: 10000, // avoid hanging requests
        raxConfig: {
            retry: 5,
            noResponseRetries: 2,
            retryDelay: 1000,
            backoffType: 'exponential',
            httpMethodsToRetry: ['POST'],
            // Retry on 5xx, 429, and informational/transient ranges
            statusCodesToRetry: [
                [100, 199],
                [429, 429],
                [500, 599]
            ],
            onRetryAttempt: (err: any) => {
                const cfg = rax.getConfig(err);
                // Avoid logging sensitive headers/tokens
                core.warning(
                    `GitHub API request failed: ${err?.response?.status || ''} ${err?.message || ''}. Retry #${
                        cfg?.currentRetryAttempt || 0
                    }`
                );
            }
        }
    });
}
