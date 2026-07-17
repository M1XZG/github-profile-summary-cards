import request from '../utils/request';
import * as core from '@actions/core';
import {getMonthlyWindows, TimeWindow} from '../utils/date-windows';

export class ProfileDetails {
    id: number; // user id
    name: string;
    email: string;
    createdAt: string;
    company: string | null = null;
    websiteUrl: string | null = null;
    twitterUsername: string | null = null;
    location: string | null = null;
    totalPublicRepos: number = 0;
    totalStars: number = 0;
    totalIssueContributions: number = 0;
    totalPullRequestContributions: number = 0;
    totalRepositoryContributions: number = 0;
    contributions: ProfileContribution[] = [];
    contributionYears: number[] = [];
    constructor(id: number, name: string, email: string, createdAt: string) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.createdAt = createdAt;
    }
}

export class ProfileContribution {
    contributionCount: number = 0;
    date: Date;
    constructor(date: Date, count: number) {
        this.date = date;
        this.contributionCount = count;
    }
}

const fetcher = (token: string, variables: any) => {
    // contain private need token permission
    // contributionsCollection default to a year ago
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query UserDetails($login: String!) {
        user(login: $login) {
            id
            name
            email
            createdAt
            twitterUsername
            company
            location
            websiteUrl
            repositories(first: 100,privacy:PUBLIC, isFork: false, ownerAffiliations: OWNER, orderBy: {direction: DESC, field: STARGAZERS}) {
              totalCount
              nodes {
                stargazers {
                  totalCount
                }
              }
            }
            contributionsCollection {
                contributionYears
            }
            pullRequests(first: 1) {
                totalCount
            }
            issues(first: 1) {
                totalCount
            }
        }
      }

      `,
            variables
        }
    );
};

// repositoriesContributedTo.totalCount is extremely expensive server-side and
// times out (502/504) for very active accounts even on its own, so fetch it in
// isolation and treat failure as best-effort (the card still renders without it).
const repositoriesContributedToFetcher = (token: string, variables: any) => {
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query UserContributedTo($login: String!) {
        user(login: $login) {
            repositoriesContributedTo(first: 1,includeUserRepositories:true, privacy:PUBLIC, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
                totalCount
            }
        }
      }
      `,
            variables
        }
    );
};

// The daily contribution calendar is the part that times out (502/504) for very
// active accounts. Fetch it one calendar month at a time.
const calendarFetcher = (token: string, variables: any, window: TimeWindow) => {
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query UserCalendar($login: String!) {
        user(login: $login) {
            contributionsCollection(from: "${window.since}", to: "${window.until}") {
                contributionCalendar {
                    weeks {
                        contributionDays {
                            contributionCount
                            date
                        }
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

export async function getProfileDetails(username: string): Promise<ProfileDetails> {
    const res = await fetcher(process.env.GITHUB_TOKEN!, {
        login: username
    });

    if (res.data.errors) {
        throw Error(res.data.errors[0].message || 'GetProfileDetails failed');
    }

    const user = res.data.data.user;
    const profileDetails = new ProfileDetails(user.id, user.name, user.email, user.createdAt);
    profileDetails.totalPublicRepos = user.repositories.totalCount;
    profileDetails.totalStars = user.repositories.nodes.reduce(
        (stars: number, curr: {stargazers: {totalCount: number}}) => {
            return stars + curr.stargazers.totalCount;
        },
        0
    );
    profileDetails.websiteUrl = user.websiteUrl;
    profileDetails.totalIssueContributions = user.issues.totalCount;
    profileDetails.totalPullRequestContributions = user.pullRequests.totalCount;
    profileDetails.company = user.company;
    profileDetails.location = user.location;
    profileDetails.twitterUsername = user.twitterUsername;
    profileDetails.contributionYears = user.contributionsCollection.contributionYears;

    // Best-effort: this count times out for very active accounts. Don't let it
    // sink the whole card; fall back to 0 if GitHub can't compute it in time.
    try {
        const contributedRes = await repositoriesContributedToFetcher(process.env.GITHUB_TOKEN!, {
            login: username
        });
        if (contributedRes.data.errors) {
            throw Error(contributedRes.data.errors[0].message || 'repositoriesContributedTo failed');
        }
        profileDetails.totalRepositoryContributions =
            contributedRes.data.data.user.repositoriesContributedTo.totalCount;
    } catch (error: any) {
        core.warning(
            `Could not fetch repositoriesContributedTo (too expensive for this account); defaulting to 0. ${
                error?.message || ''
            }`
        );
        profileDetails.totalRepositoryContributions = 0;
    }

    // Fetch the daily calendar month by month and dedupe days by date, since
    // adjacent monthly windows can share boundary days.
    const until = new Date();
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    const dayMap = new Map<string, number>();
    for (const window of getMonthlyWindows(since, until)) {
        const calRes = await calendarFetcher(process.env.GITHUB_TOKEN!, {login: username}, window);
        if (calRes.data.errors) {
            throw Error(calRes.data.errors[0].message || 'GetProfileDetails failed');
        }
        for (const week of calRes.data.data.user.contributionsCollection.contributionCalendar.weeks) {
            for (const day of week.contributionDays) {
                dayMap.set(day.date, day.contributionCount);
            }
        }
    }
    Array.from(dayMap.keys())
        .sort()
        .forEach(date => {
            profileDetails.contributions.push(new ProfileContribution(new Date(date), dayMap.get(date)!));
        });

    return profileDetails;
}
