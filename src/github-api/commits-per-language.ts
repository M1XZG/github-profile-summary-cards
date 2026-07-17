import request from '../utils/request';
import {getMonthlyWindows, TimeWindow} from '../utils/date-windows';

export class CommitLanguageInfo {
    name: string;
    color: string; // hexadecimal color code
    count: number;

    constructor(name: string, color: string = '#586e75', count: number) {
        this.name = name;
        this.color = color;
        this.count = count;
    }
}

export class CommitLanguages {
    private languageMap = new Map<string, CommitLanguageInfo>();

    public addLanguageCount(name: string, color: string, count: number): void {
        if (this.languageMap.has(name)) {
            const lang = this.languageMap.get(name)!;
            lang.count += count;
            this.languageMap.set(name, lang);
        } else {
            this.languageMap.set(name, new CommitLanguageInfo(name, color, count));
        }
    }

    public getLanguageMap(): Map<string, CommitLanguageInfo> {
        return this.languageMap;
    }
}

const fetcher = (token: string, variables: any, window: TimeWindow) => {
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query CommitLanguages($login: String!) {
        user(login: $login) {
          contributionsCollection(from: "${window.since}", to: "${window.until}") {
            commitContributionsByRepository(maxRepositories: 100) {
              repository {
                primaryLanguage {
                  name
                  color
                }
              }
              contributions {
                  totalCount
              }
            }
          }
        }
      }
      `,
            variables
        }
    );
};

// commits per language over the last year. A single 12-month contributionsCollection
// query times out (502/504) for very active accounts, so fetch it one calendar
// month at a time and accumulate per-language counts (the CommitLanguages map
// already sums repeated languages across windows).
export async function getCommitLanguage(username: string, exclude: Array<string>): Promise<CommitLanguages> {
    const commitLanguages = new CommitLanguages();

    const until = new Date();
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    const windows = getMonthlyWindows(since, until);

    for (const window of windows) {
        const res = await fetcher(
            process.env.GITHUB_TOKEN!,
            {
                login: username
            },
            window
        );

        if (res.data.errors) {
            throw Error(res.data.errors[0].message || 'GetCommitLanguage failed');
        }

        res.data.data.user.contributionsCollection.commitContributionsByRepository.forEach(
            (node: {
                repository: {primaryLanguage: {name: string; color: string} | null};
                contributions: {totalCount: number};
            }) => {
                if (node.repository.primaryLanguage == null) {
                    return;
                }
                const langName = node.repository.primaryLanguage.name;
                const langColor = node.repository.primaryLanguage.color;
                const totalCount = node.contributions.totalCount;
                if (exclude.indexOf(langName.toLowerCase()) === -1) {
                    commitLanguages.addLanguageCount(langName, langColor, totalCount);
                }
            }
        );
    }

    return commitLanguages;
}
