game types:
    1. practice: a practice game is identical to a play game except that it is not part of some game sequence and receives its own unique bandit 
    2. play: a play game is one where the user moves around the cells of the grid and shoots or mines for minerals (i.e. pulls the arms of the bandit)
    3. watch: a watch game is one where the user passively watches a demonstrator play the game defined by the trajectory within the demonstrator object in the timeline
    4. indicate: an indicate game is the same as a watch game with the exception that rewards are not observed and shots are not fired (or in other words arms are not pulled), instead only a blinking light flashes around the arms of the bandit that the demonstrator suggests
    5. blind: a blind game is the same as a play game except that the only difference is that no rewards are observed and hence no green or red markers are displayed on the bandit and no mining mineral reward tank is shown on the screen 


game sequences:
    1. games sequences are lists of lists as follows: [[play, watch], [indicate, play]], so we can think about this game sequence as having two parts, part 1 being the play game followed by a watch game, and part 2 being an indicate game followed by a play game, 