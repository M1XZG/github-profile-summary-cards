import request from '../utils/request';
import {getMonthlyWindows} from '../utils/date-windows';

export class ProfuctiveTime {
    productiveDate: Date[] = [];

    public addProductiveDate(date: Date) {
        this.productiveDate.push(date);
    }
}

const userIdFetcher = (token: string, variables: any) => {
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query getUserId($login: String!) {
        user(login: $login) {
            id
        }
      }
     `,
            variables
        }
    );
};

// We use commit datetime to calculate productive time
const fetcher = (token: string, variables: any, window: {since: string; until: string}) => {
    return request(
        {
            Authorization: `bearer ${token}`
        },
        {
            query: `
      query ProductiveTime($login: String!, $userId: ID!, $until: GitTimestamp!, $since: GitTimestamp!) {
        user(login: $login) {
          contributionsCollection(from: "${window.since}", to: "${window.until}"){
            commitContributionsByRepository(maxRepositories:50) {
              repository {
                defaultBranchRef {
                  target {
                    ... on Commit {
                      history(first: 50,since: $since,until: $until,author:{id:$userId}) {
                        edges {
                          node {
                            message
                            author{
                              email
                            }
                            committedDate
                          }
                        }
                      }
                    }
                  }
                }
                name
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

// get productive time
export async function getProductiveTime(username: string, until: string, since: string): Promise<ProfuctiveTime> {
    const userIdResponse = await userIdFetcher(process.env.GITHUB_TOKEN!, {
        login: username
    });

    if (userIdResponse.data.errors) {
        throw Error(userIdResponse.data.errors[0].message || 'GetProductiveTime failed');
    }

    const userId = userIdResponse.data.data.user.id;
    const productiveTime = new ProfuctiveTime();

    // The commit-history query is expensive; a full-year window can time out or
    // trip secondary rate-limits for very active accounts. Walk it month by month.
    const windows = getMonthlyWindows(new Date(since), new Date(until));
    for (const window of windows) {
        const res = await fetcher(process.env.GITHUB_TOKEN!, {
            login: username,
            userId: userId,
            until: window.until,
            since: window.since
        }, window);

        if (res.data.errors) {
            throw Error(res.data.errors[0].message || 'GetProductiveTime failed');
        }

        res.data.data.user.contributionsCollection.commitContributionsByRepository.forEach(
            (node: {
                repository: {
                    defaultBranchRef: {target: {history: {edges: any[]}}} | null;
                };
            }) => {
                if (node.repository.defaultBranchRef != null) {
                    node.repository.defaultBranchRef.target.history.edges.forEach(edge => {
                        // Ensure type Date is stored
                        productiveTime.addProductiveDate(new Date(edge.node.committedDate));
                    });
                }
            }
        );
    }

    return productiveTime;
}
