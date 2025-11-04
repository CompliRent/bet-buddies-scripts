Our project purpose is to create the fantasy sports of sports betting. Instead of picking players and hoping they score you points. Now, users will pick their favorite moneylines, spreads, overunders, etc. and see if their betting is prowess is better thant their peers.
Every week players will select 5 bets that they think are winners. Users will keep be able to track their results and compare their success to others in their leagues. Did you friend go 5/5 on his parlay this week? That's only because he picked the safest bets possible. Lame.
Users will sign-up, join a league with their friends, pick their bets for the week, track them, and then compare their results on a league leaderboard.

In order to do this we will be integrating with an API that provides live odds and results for different leagues and games around the world. We will fetch the odds every morning and make them available to users. When users select a bet, that bet is frozen and saved to their bet card. Then as games finish, we fetch results, compare to the saved bets and calculate whether you are a winner or not. When users navigate to the league leaderboard page, we will calcualte and cache the leaderboard for the user to use to brag.

Inital objects
- Users
- Leagues
- Cards
- Bets
ERD- <img width="772" height="441" alt="image" src="https://github.com/user-attachments/assets/51938b98-e18f-444f-b42f-fcb93ec79ea4" />

Technologies
- Nextjs
- Supabase
- Redis
- SportsGameOdds API

Systems Design- <img width="564" height="444" alt="image" src="https://github.com/user-attachments/assets/ee0b1966-7ade-4118-ab5c-fdeef59ee421" />


Goals
11/7
- get back end hosted
- integrate with supabase
- integrate with api and cache results from fetch
11/14
- handle user register/signup
- league creation/ join
11/21
- users can select bets and build cards
- evaluate success of bets
11/28
- add timers so cards reset every week
- add leaderboards
- add history
- 
12/5
- clean UI
- redo results engine
- group chat
