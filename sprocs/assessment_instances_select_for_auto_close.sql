CREATE OR REPLACE FUNCTION
    assessment_instances_select_for_auto_close(
        IN age_mins integer, -- time in minutes (after last activity) when we auto-close an exam
        OUT assessment_instance_id bigint,
        OUT credit integer,
        OUT last_active_date timestamp with time zone,
        OUT user_id bigint,
        OUT user_uid text
    ) RETURNS SETOF RECORD
AS $$
DECLARE
    assessment_instance assessment_instances;
    mode enum_mode;
    role enum_role;
    display_timezone text;
BEGIN
    -- start with all assessment_instances that are subject to auto-closing
    FOR assessment_instance IN
        SELECT
            ai.*
        FROM
            assessment_instances AS ai
            JOIN assessments AS a ON (a.id = ai.assessment_id)
        WHERE
            ai.open = true
            AND a.type = 'Exam'
            AND ai.auto_close
    LOOP
        assessment_instance_id := assessment_instance.id;

        -- find the oldest submission information
        SELECT s.date, s.mode
        INTO last_active_date, mode
        FROM
            instance_questions AS iq
            JOIN variants AS v ON (v.instance_question_id = iq.id)
            JOIN submissions AS s ON (s.variant_id = v.id)
        WHERE
            iq.assessment_instance_id = assessment_instance.id
        ORDER BY
            s.id, s.date DESC
        LIMIT 1;

        -- if we didn't get anything from submissions then use exam start date and mode
        last_active_date := coalesce(last_active_date, assessment_instance.date);
        mode := coalesce(mode, assessment_instance.mode);

        -- only keep assessment_instances with no recent activity
        IF assessment_instance.date_limit IS NOT NULL THEN
            CONTINUE WHEN current_timestamp - assessment_instance.date_limit < '1 minute';
        ELSE
            CONTINUE WHEN current_timestamp - last_active_date < make_interval(mins => age_mins);
        END IF;

        -- determine credit
        SELECT caa.credit, u.user_id, u.uid
        INTO credit, user_id, user_uid
        FROM
            assessments AS a
            JOIN course_instances AS ci ON (ci.id = a.course_instance_id)
            JOIN users AS u ON (u.user_id = assessment_instance.user_id)
            LEFT JOIN enrollments AS e ON (e.user_id = u.user_id AND e.course_instance_id = ci.id)
            JOIN LATERAL check_assessment_access(a.id, mode, coalesce(e.role, 'Student'), u.uid, last_active_date, ci.display_timezone) AS caa ON TRUE
        WHERE
            a.id = assessment_instance.assessment_id;
            -- Don't check access. The submissions were allowed, so grading must be ok.

        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE;
