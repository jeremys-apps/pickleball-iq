# Learning design

Why Court Sense works the way it does. The references are recalled from the
literature rather than freshly checked; verify them before citing them anywhere
that matters.

## Retrieval beats rereading

Answering a question strengthens memory more than reviewing the same material,
even when the answer is not given right away (Roediger and Karpicke 2006). Every
card is therefore a question first. Even the recall cards (why, form cue, drill)
ask you to produce the answer before showing it.

## Spacing, scheduled by FSRS

Reviews spread over days and weeks produce far better long-term retention than
the same number of reviews massed together (Cepeda and colleagues 2006). The app
uses FSRS through `ts-fsrs` to time each review for a target recall probability
of 90 percent (`requestRetention`). FSRS models each card's stability and
difficulty from your rating history (Ye, Su and Cao 2022, and the
open-spaced-repetition project). Ratings are suggested from correctness and
response time so the scheduler gets consistent input, but you can always
override them.

There is no daily cap. Spacing still does its work: a card you answer correctly
does not return until its interval has passed, and a big day of new cards mainly
raises the review load on the following days, which the optional new-card limit
can smooth out.

## Interleaving and variation

Mixing problem types in practice improves the ability to pick the right method,
compared with practicing one type at a time (Rohrer and Taylor 2007). Each batch
introduces one variant of every principle before any second variant, prefers
principles not yet seen that day, and never puts two cards of one principle side
by side when it can avoid it. A principle gets a second court card only when its sources describe a genuinely
different situation, so each picture stands for something the pros actually said.
To keep you from memorizing one picture, a court card alternates between its
authored picture and its mirror image on successive reviews: the same situation
from the other side of the court, with no extra cards. The choices vary too: each
showing draws one phrasing of the correct play and up to three wrong answers from
a pool, the correct choice moves through every position, and consecutive showings
share only one wrong answer, so neither position nor a remembered list gives the
answer away. Prompts also avoid stating the cue the picture shows, so the court,
not the text, has to be read.

## Guidance that fades

Frequent, immediate guidance helps early performance but can create dependence
and hurt learning that has to stand on its own, the guidance hypothesis (Salmoni,
Schmidt and Walter 1984). This is why the aids fade: a new card shows the flight
path, shadow, height stalk and a full top-down map at reduced speed; a mature card poses the question with only the ball and its shadow at real speed,
the way the court presents it. A related finding, the specificity of practice, is
that learners come to rely on whatever information was present during practice,
so practicing with a painted flight path trains a read that needs one (Proteau
1992). Feedback after the response is a different matter. Once you have answered,
every aid returns at every stage, so you check your read against the full
picture without leaning on it while you decide. Making practice harder in ways
that slow acquisition but improve retention is Bjork's "desirable difficulties"
idea (Bjork 1994).

## Focus outward

Instructions that direct attention to an external effect (the ball, the target,
the paddle face) usually produce better learning and performance than
instructions about body movements (Wulf 2013, a review of about fifteen years of
studies). Focus cues are written that way where the source allows: "Paddle out
front, punch through the middle" rather than "bend your elbow".

## Reading the play: temporal occlusion

Expert players anticipate from early information, and experts outperform novices
on perceptual-cognitive tasks such as anticipation and decision making (Mann and
colleagues 2007, a meta-analysis). Temporal occlusion shows a clip of an opponent
and cuts it off at or before contact, then asks what happens next. Training with
occluded video improved tennis players' anticipation of serves (Farrow and
Abernethy 2002), and perceptual training with instruction and feedback improved
anticipation and transferred to on-court responses in a field-based test
(Williams, Ward, Knowles and Smeeton 2002).

The timed cards borrow the method: lead-in shots, a freeze just before your
contact, and two to three seconds to decide. Two caveats. The app's animation is
stylized, so it trains reading the ball's flight and the players' positions, not
subtle body tells. And transfer from screen to court is the weakest link in this
literature, which is why each session ends with one cue to carry onto the court,
and why Phase 5 adds opponent cues only where a pro names them.

## References

- Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In J. Metcalfe and A. Shimamura (Eds.), *Metacognition: Knowing about knowing* (pp. 185-205). MIT Press.
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., and Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3), 354-380.
- Farrow, D., and Abernethy, B. (2002). Can anticipatory skills be learned through implicit video-based perceptual training? *Journal of Sports Sciences, 20*(6), 471-485.
- Mann, D. T. Y., Williams, A. M., Ward, P., and Janelle, C. M. (2007). Perceptual-cognitive expertise in sport: A meta-analysis. *Journal of Sport and Exercise Psychology, 29*(4), 457-478.
- Roediger, H. L., and Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3), 249-255.
- Proteau, L. (1992). On the specificity of learning and the role of visual information for movement control. In L. Proteau and D. Elliott (Eds.), *Vision and motor control* (pp. 67-103). North-Holland.
- Rohrer, D., and Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science, 35*, 481-498.
- Salmoni, A. W., Schmidt, R. A., and Walter, C. B. (1984). Knowledge of results and motor learning: A review and critical reappraisal. *Psychological Bulletin, 95*(3), 355-386.
- Williams, A. M., Ward, P., Knowles, J. M., and Smeeton, N. J. (2002). Anticipation skill in a real-world task: Measurement, training, and transfer in tennis. *Journal of Experimental Psychology: Applied, 8*(4), 259-270.
- Wulf, G. (2013). Attentional focus and motor learning: A review of 15 years. *International Review of Sport and Exercise Psychology, 6*(1), 77-104.
- Ye, J., Su, J., and Cao, Y. (2022). A stochastic shortest path algorithm for optimizing spaced repetition scheduling. *Proceedings of KDD 2022*.
