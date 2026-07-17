import request from '../utils/request';
import {getYearMonthlyWindows, TimeWindow} from '../utils/date-windows';

export class ConrtibutionByYear {
    year: number;
    totalCommitContributions: number;
    totalContributions: number;
    constructor(year: number, totalCommitContributions: number, totalContributions: number) {
        this.year = year;
        this.totalCommitContributions = totalCommitContributions;
        this.totalContributions = totalContributions;
    }
}

const fetcher = (token: string, variables: any, window: TimeWindow) => {
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query ContributionsByYear($login: String!) {
        user(login: $login) {
            contributionsCollection(from: "${window.since}", to: "${window.until}") {
                    totalCommitContributions
                    contributionCalendar {
                        totalContributions
                    }
                }
            }
        }
      `,
            variables
        }
    );
};

// A single full-year query is cheap for quiet years but times out (502/504) at
// GitHub's gateway for very active years. Try the whole year first and only fall
// back to per-month windows when it fails, to keep request volume low.
export async function getContributionByYear(username: string, year: number): Promise<ConrtibutionByYear> {
    const yearWindows = getYearMonthlyWindows(year);
    if (yearWindows.length === 0) {
        return new ConrtibutionByYear(year, 0, 0);
    }

    const fullYear: TimeWindow = {
        since: yearWindows[0].since,
        until: yearWindows[yearWindows.length - 1].until
    };

    try {
        const res = await fetcher(process.env.GITHUB_TOKEN!, {login: username}, fullYear);
        if (res.data.errors) {
            throw Error(res.data.errors[0].message || 'GetContributionByYear failed');
        }
        const collection = res.data.data.user.contributionsCollection;
        return new ConrtibutionByYear(
            year,
            collection.totalCommitContributions,
            collection.contributionCalendar.totalContributions
        );
    } catch (error) {
        // Heavy year: aggregate month by month (exact, since windows never overlap).
    }

    let totalCommitContributions = 0;
    let totalContributions = 0;

    for (const window of yearWindows) {
        const res = await fetcher(
            process.env.GITHUB_TOKEN!,
            {
                login: username
            },
            window
        );

        if (res.data.errors) {
            throw Error(res.data.errors[0].message || 'GetContributionByYear failed');
        }

        const collection = res.data.data.user.contributionsCollection;
        totalCommitContributions += collection.totalCommitContributions;
        totalContributions += collection.contributionCalendar.totalContributions;
    }

    return new ConrtibutionByYear(year, totalCommitContributions, totalContributions);
}
